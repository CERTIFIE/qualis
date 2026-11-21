using System.Collections.Immutable;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.MSBuild;

namespace Qualis.Roslyn;

/// <summary>Loads the project or solution with MSBuild and runs the CA analyzers once, in prepare.</summary>
internal sealed class SolutionAnalyzer(RuleCatalog catalog, Action<string, string> log)
{
    private static readonly StringComparer PathComparer =
        OperatingSystem.IsLinux() ? StringComparer.Ordinal : StringComparer.OrdinalIgnoreCase;

    private readonly Dictionary<string, List<JsonObject>> _issues = new(PathComparer);

    /// <summary>Normalises a path so that the paths of MSBuild and of the host compare equal.</summary>
    public static string Canonical(string path)
    {
        var full = Path.GetFullPath(path);
        // macOS: /var and /tmp are symbolic links to /private/var and /private/tmp.
        if (OperatingSystem.IsMacOS() && (full.StartsWith("/private/var/", StringComparison.Ordinal) || full.StartsWith("/private/tmp/", StringComparison.Ordinal)))
            full = full["/private".Length..];
        return full;
    }

    public IReadOnlyList<JsonObject> IssuesFor(string absolutePath, ISet<string> ruleIds) =>
        _issues.TryGetValue(Canonical(absolutePath), out var list)
            ? list.Where(i => ruleIds.Contains((string)i["ruleId"]!)).ToList()
            : [];

    public async Task PrepareAsync(string baseDir, JsonObject options, ISet<string> enabledDiagnosticIds, CancellationToken token)
    {
        var targets = FindTargets(baseDir, options);
        if (targets.Count == 0)
            throw new InvalidOperationException($"No .slnx, .sln or .csproj file found in {baseDir}");
        if (options["restore"]?.GetValue<bool>() != false) await RestoreIfNeededAsync(baseDir, targets, token);

        var analyzers = catalog.Analyzers
            .Where(a => a.SupportedDiagnostics.Any(d => enabledDiagnosticIds.Contains(d.Id)))
            .ToImmutableArray();
        if (analyzers.IsEmpty) return;

        using var workspace = MSBuildWorkspace.Create();
        workspace.RegisterWorkspaceFailedHandler(e =>
        {
            if (e.Diagnostic.Kind == WorkspaceDiagnosticKind.Failure) log("warning", e.Diagnostic.Message);
        });
        foreach (var target in targets)
        {
            try
            {
                if (target.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase))
                {
                    if (!workspace.CurrentSolution.Projects.Any(p => PathComparer.Equals(p.FilePath, target)))
                        await workspace.OpenProjectAsync(target, cancellationToken: token);
                }
                else
                {
                    await workspace.OpenSolutionAsync(target, cancellationToken: token);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log("warning", $"Cannot load {Path.GetRelativePath(baseDir, target)}: {ex.Message}");
            }
        }

        var projects = workspace.CurrentSolution.Projects.Where(p => p.Language == LanguageNames.CSharp).ToList();
        if (projects.Count == 0) throw new InvalidOperationException("No C# project could be loaded by MSBuild");

        var severities = catalog.Descriptors.Keys.ToImmutableDictionary(
            id => id,
            id => enabledDiagnosticIds.Contains(id) ? ReportDiagnostic.Warn : ReportDiagnostic.Suppress);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var original in projects)
        {
            var project = WithoutSdkAnalysisLevel(original);
            var compilation = await project.GetCompilationAsync(token);
            if (compilation is null) continue;
            var errors = compilation.GetDiagnostics(token).Count(d => d.Severity == DiagnosticSeverity.Error);
            if (errors > 0) log("warning", $"{project.Name}: {errors} compiler error(s); results for this project may be incomplete");

            compilation = compilation.WithOptions(compilation.Options.WithSpecificDiagnosticOptions(
                compilation.Options.SpecificDiagnosticOptions.SetItems(severities)));
            var withAnalyzers = compilation.WithAnalyzers(analyzers, new CompilationWithAnalyzersOptions(
                project.AnalyzerOptions,
                onAnalyzerException: (ex, analyzer, _) => log("warning", $"{analyzer.GetType().Name} failed: {ex.Message}"),
                concurrentAnalysis: true,
                logAnalyzerExecutionTime: false));
            foreach (var diagnostic in await withAnalyzers.GetAnalyzerDiagnosticsAsync(token))
            {
                if (!enabledDiagnosticIds.Contains(diagnostic.Id) || !diagnostic.Location.IsInSource) continue;
                var path = Canonical(diagnostic.Location.SourceTree!.FilePath);
                var span = diagnostic.Location.GetLineSpan();
                var (startLine, startColumn) = (span.StartLinePosition.Line + 1, span.StartLinePosition.Character + 1);
                var (endLine, endColumn) = (span.EndLinePosition.Line + 1, span.EndLinePosition.Character + 1);
                if (endLine < startLine || (endLine == startLine && endColumn <= startColumn)) (endLine, endColumn) = (startLine, startColumn + 1);
                var message = diagnostic.GetMessage(CultureInfo.InvariantCulture);
                // Multi-targeted projects compile the same file once per target framework.
                if (!seen.Add($"{diagnostic.Id}|{path}|{startLine}|{startColumn}|{message}")) continue;
                if (!_issues.TryGetValue(path, out var list)) _issues[path] = list = [];
                list.Add(new JsonObject
                {
                    ["ruleId"] = RuleCatalog.RuleId(diagnostic.Id),
                    ["message"] = message,
                    ["range"] = new JsonObject { ["startLine"] = startLine, ["startColumn"] = startColumn, ["endLine"] = endLine, ["endColumn"] = endColumn },
                });
            }
        }
    }

    /// <summary>
    /// Removes the analysis-level configuration injected by the SDK, which would
    /// disable most CA rules; the project's own .editorconfig files are kept.
    /// </summary>
    private static Project WithoutSdkAnalysisLevel(Project project)
    {
        var sdkConfigs = project.AnalyzerConfigDocuments
            .Where(d => d.FilePath is { } p && (Path.GetFileName(p).StartsWith("analysislevel", StringComparison.OrdinalIgnoreCase) || p.Contains("Microsoft.CodeAnalysis.NetAnalyzers", StringComparison.OrdinalIgnoreCase)))
            .Select(d => d.Id)
            .ToList();
        foreach (var id in sdkConfigs) project = project.RemoveAnalyzerConfigDocument(id);
        return project;
    }

    private static List<string> FindTargets(string baseDir, JsonObject options)
    {
        if (options["solution"]?.GetValue<string>() is { } solution) return [Path.GetFullPath(Path.Combine(baseDir, solution))];
        if (options["projects"] is JsonArray projects) return projects.Select(p => Path.GetFullPath(Path.Combine(baseDir, p!.GetValue<string>()))).ToList();
        var root = Directory.GetFiles(baseDir, "*.slnx").Concat(Directory.GetFiles(baseDir, "*.sln")).ToList();
        if (root.Count > 0) return [root.Order(StringComparer.Ordinal).First()];
        return Enumerate(baseDir, "*.csproj").Order(StringComparer.Ordinal).ToList();
    }

    private static readonly HashSet<string> SkippedFolders = new(StringComparer.OrdinalIgnoreCase) { "bin", "obj", "node_modules", ".git", ".qualis" };

    private static IEnumerable<string> Enumerate(string dir, string pattern)
    {
        foreach (var file in Directory.EnumerateFiles(dir, pattern)) yield return file;
        foreach (var sub in Directory.EnumerateDirectories(dir))
        {
            if (SkippedFolders.Contains(Path.GetFileName(sub))) continue;
            foreach (var file in Enumerate(sub, pattern)) yield return file;
        }
    }

    private async Task RestoreIfNeededAsync(string baseDir, List<string> targets, CancellationToken token)
    {
        var unrestored = Enumerate(baseDir, "*.csproj")
            .Where(p => !File.Exists(Path.Combine(Path.GetDirectoryName(p)!, "obj", "project.assets.json")))
            .ToList();
        if (unrestored.Count == 0) return;
        foreach (var target in targets)
        {
            log("info", $"Restoring {Path.GetRelativePath(baseDir, target)} (dotnet restore)");
            var info = new ProcessStartInfo("dotnet", ["restore", target, "--nologo", "-v", "q"])
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = baseDir,
            };
            using var process = Process.Start(info)!;
            var output = await process.StandardOutput.ReadToEndAsync(token) + await process.StandardError.ReadToEndAsync(token);
            await process.WaitForExitAsync(token);
            if (process.ExitCode != 0) log("warning", $"dotnet restore failed for {Path.GetFileName(target)}: {output.Trim()}");
        }
    }
}
