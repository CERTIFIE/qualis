using System.Collections.Immutable;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json.Nodes;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Qualis.Roslyn;

/// <summary>The Microsoft code analysis rules (CA) shipped with this plugin, exposed as Qualis rules.</summary>
internal sealed class RuleCatalog
{
    /// <summary>Qualis C# rules replaced by a CA rule detecting the same problem with semantic information.</summary>
    private static readonly Dictionary<string, string[]> Supersedes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["CA2200"] = ["csharp:preserve-stack-on-rethrow"],
        ["CA2242"] = ["csharp:no-compare-nan"],
        ["CA3075"] = ["csharp:no-insecure-xml-dtd"],
        ["CA5350"] = ["csharp:no-weak-hash", "csharp:no-weak-cipher"],
        ["CA5351"] = ["csharp:no-weak-hash", "csharp:no-weak-cipher"],
        ["CA5358"] = ["csharp:no-weak-cipher"],
    };

    /// <summary>CA rules overlapping a Qualis rule that covers more APIs: disabled by default to avoid duplicates.</summary>
    private static readonly Dictionary<string, string> Overlaps = new(StringComparer.OrdinalIgnoreCase)
    {
        ["CA2100"] = "csharp:no-sql-injection",
        ["CA2300"] = "csharp:no-insecure-deserializer",
        ["CA2301"] = "csharp:no-insecure-deserializer",
        ["CA5359"] = "csharp:no-certificate-validation-bypass",
    };

    public ImmutableArray<DiagnosticAnalyzer> Analyzers { get; }
    public IReadOnlyDictionary<string, DiagnosticDescriptor> Descriptors { get; }

    /// <summary>Rules enabled by Microsoft's "Recommended" analysis mode, with their severity.</summary>
    private readonly IReadOnlyDictionary<string, string> _recommended;

    private RuleCatalog(ImmutableArray<DiagnosticAnalyzer> analyzers, IReadOnlyDictionary<string, DiagnosticDescriptor> descriptors, IReadOnlyDictionary<string, string> recommended)
    {
        Analyzers = analyzers;
        Descriptors = descriptors;
        _recommended = recommended;
    }

    /// <summary>Reads `dotnet_diagnostic.CAxxxx.severity = value` entries that are not `none`.</summary>
    private static Dictionary<string, string> ReadRecommended(string file)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in File.ReadLines(file))
        {
            var match = System.Text.RegularExpressions.Regex.Match(line, @"^\s*dotnet_diagnostic\.(CA\d+)\.severity\s*=\s*(\w+)");
            if (match.Success && match.Groups[2].Value != "none") result[match.Groups[1].Value] = match.Groups[2].Value;
        }
        return result;
    }

    public static RuleCatalog Load()
    {
        var folder = Path.Combine(AppContext.BaseDirectory, "analyzers");
        var loader = new AnalyzerLoader();
        var analyzers = Directory.GetFiles(folder, "*.dll")
            .OrderBy(f => f, StringComparer.Ordinal)
            .SelectMany(f => new AnalyzerFileReference(f, loader).GetAnalyzers(LanguageNames.CSharp))
            .ToImmutableArray();
        var descriptors = new SortedDictionary<string, DiagnosticDescriptor>(StringComparer.Ordinal);
        foreach (var analyzer in analyzers)
        {
            foreach (var d in analyzer.SupportedDiagnostics)
            {
                if (d.Id.StartsWith("CA", StringComparison.Ordinal) && !descriptors.ContainsKey(d.Id)) descriptors[d.Id] = d;
            }
        }
        return new RuleCatalog(analyzers, descriptors, ReadRecommended(Path.Combine(folder, "recommended.globalconfig")));
    }

    public static string RuleId(string diagnosticId) => $"roslyn:{diagnosticId.ToLowerInvariant()}";

    /// <summary>Type of issue from the CA category.</summary>
    private static string TypeOf(DiagnosticDescriptor d) => d.Category switch
    {
        "Security" => "vulnerability",
        "Reliability" or "Usage" => "bug",
        _ => "code-smell",
    };

    /// <summary>Severity by issue type; Microsoft's `error` level and default errors are critical.</summary>
    private string SeverityOf(DiagnosticDescriptor d, string type)
    {
        if (d.DefaultSeverity == DiagnosticSeverity.Error || (_recommended.TryGetValue(d.Id, out var level) && level == "error")) return "critical";
        return type switch
        {
            "vulnerability" or "bug" => "major",
            _ => d.Category is "Naming" or "Globalization" or "Documentation" ? "info" : "minor",
        };
    }

    /// <summary>
    /// Default profile: Microsoft's "Recommended" analysis mode for .NET 10
    /// (AnalysisMode=Recommended). Rules overlapping a broader Qualis rule start disabled.
    /// </summary>
    private bool EnabledByDefault(DiagnosticDescriptor d) => !Overlaps.ContainsKey(d.Id) && _recommended.ContainsKey(d.Id);

    public JsonArray Manifest()
    {
        var rules = new JsonArray();
        foreach (var (id, d) in Descriptors)
        {
            var type = TypeOf(d);
            var title = d.Title.ToString().Trim().TrimEnd('.');
            var description = d.Description.ToString().Trim();
            var url = string.IsNullOrEmpty(d.HelpLinkUri)
                ? $"https://learn.microsoft.com/dotnet/fundamentals/code-analysis/quality-rules/{id.ToLowerInvariant()}"
                : d.HelpLinkUri.Replace("http://", "https://", StringComparison.Ordinal);
            var rationale = $"This rule is defined and maintained by Microsoft as part of the .NET code analysis rules (category {d.Category}); the linked Microsoft Learn page explains the problem, how to fix it and when to suppress it. Qualis runs the analyzer unchanged, with semantic information from the compiled project.";
            rationale += _recommended.ContainsKey(id)
                ? " It is enabled by default because Microsoft's Recommended analysis mode enables it."
                : " It is not part of Microsoft's Recommended analysis mode, so it is disabled by default.";
            if (Supersedes.TryGetValue(id, out var replaced))
                rationale += $" When enabled it replaces {string.Join(", ", replaced.Select(r => $"`{r}`"))}.";
            if (Overlaps.TryGetValue(id, out var overlap))
                rationale += $" It overlaps with `{overlap}`, which also covers other APIs, so it is disabled by default.";
            var rule = new JsonObject
            {
                ["id"] = RuleId(id),
                ["name"] = string.IsNullOrEmpty(title) ? id : title,
                ["languages"] = new JsonArray("csharp"),
                ["type"] = type,
                ["severity"] = SeverityOf(d, type),
                ["tags"] = new JsonArray("roslyn", d.Category.ToLowerInvariant(), id.ToLowerInvariant()),
                ["enabledByDefault"] = EnabledByDefault(d),
                ["effortMinutes"] = type == "vulnerability" ? 30 : type == "bug" ? 10 : 5,
                ["description"] = $"{(string.IsNullOrEmpty(description) ? title : description)} Runs Microsoft rule {id} unchanged.",
                ["rationale"] = rationale,
                ["exceptions"] = "Requires the .NET SDK and a project or solution that can be loaded (restored) by MSBuild. Severity overrides in .editorconfig files of the project are honoured by the analyzer.",
                ["references"] = new JsonArray(new JsonObject
                {
                    ["publisher"] = "Microsoft Learn",
                    ["id"] = id,
                    ["title"] = $"{id}: {title}",
                    ["url"] = url,
                }),
            };
            if (replaced is not null) rule["supersedes"] = new JsonArray(replaced.Select(r => (JsonNode)r!).ToArray());
            rules.Add(rule);
        }
        return rules;
    }

    /// <summary>Loads analyzer assemblies into the default context.</summary>
    private sealed class AnalyzerLoader : IAnalyzerAssemblyLoader
    {
        public void AddDependencyLocation(string fullPath) { }

        public Assembly LoadFromPath(string fullPath) => AssemblyLoadContext.Default.LoadFromAssemblyPath(fullPath);
    }
}
