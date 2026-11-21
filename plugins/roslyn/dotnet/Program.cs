// Qualis rule pack running the Microsoft .NET code analysis rules (CA) with Roslyn.
//
// It implements the Qualis stdio plugin protocol: JSON-RPC 2.0 messages, one per
// line, on stdin/stdout. Anything else written to the console goes to stderr.
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Qualis.Roslyn;

var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
// Libraries must never write to the protocol channel.
Console.SetOut(Console.Error);

var version = typeof(RuleCatalog).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "0.0.0";
RuleCatalog? catalog = null;
SolutionAnalyzer? analyzer = null;

void Send(JsonObject message)
{
    message["jsonrpc"] = "2.0";
    lock (output) output.WriteLine(message.ToJsonString());
}

void Log(string level, string message) =>
    Send(new JsonObject { ["method"] = "log", ["params"] = new JsonObject { ["level"] = level, ["message"] = message } });

HashSet<string> DiagnosticIds(JsonNode? rules) =>
    (rules as JsonArray ?? [])
        .Select(r => (string)r!["id"]!)
        .Where(id => id.StartsWith("roslyn:", StringComparison.Ordinal))
        .Select(id => id["roslyn:".Length..].ToUpperInvariant())
        .ToHashSet(StringComparer.Ordinal);

async Task<JsonNode?> HandleAsync(string method, JsonObject parameters)
{
    switch (method)
    {
        case "initialize":
            if (parameters["apiVersion"]?.GetValue<int>() != 1) throw new ArgumentException("Unsupported plugin API version");
            catalog = RuleCatalog.Load();
            return new JsonObject
            {
                ["apiVersion"] = 1,
                ["kind"] = "rule-pack",
                ["id"] = "roslyn",
                ["name"] = "Roslyn (.NET code analysis)",
                ["version"] = version,
                ["description"] = "Runs the Microsoft .NET code analysis rules (CA) with semantic information from the compiled projects.",
                ["homepage"] = "https://learn.microsoft.com/dotnet/fundamentals/code-analysis/overview",
                ["languages"] = new JsonArray(new JsonObject { ["id"] = "csharp", ["name"] = "C#", ["extensions"] = new JsonArray(".cs") }),
                ["rules"] = catalog.Manifest(),
            };
        case "prepare":
            analyzer = new SolutionAnalyzer(catalog ?? RuleCatalog.Load(), Log);
            await analyzer.PrepareAsync(
                (string)parameters["baseDir"]!,
                parameters["options"] as JsonObject ?? [],
                DiagnosticIds(parameters["rules"]),
                CancellationToken.None);
            return null;
        case "analyzeFile":
            {
                var path = (string)parameters["file"]!["absolutePath"]!;
                var ruleIds = (parameters["rules"] as JsonArray ?? []).Select(r => (string)r!["id"]!).ToHashSet(StringComparer.Ordinal);
                var issues = new JsonArray(analyzer?.IssuesFor(path, ruleIds).Select(i => (JsonNode)i.DeepClone()).ToArray() ?? []);
                return new JsonObject { ["issues"] = issues };
            }
        case "shutdown":
            return null;
        default:
            throw new MissingMethodException(method);
    }
}

while (await input.ReadLineAsync() is { } line)
{
    if (string.IsNullOrWhiteSpace(line)) continue;
    JsonObject message;
    try
    {
        message = JsonNode.Parse(line)!.AsObject();
    }
    catch (JsonException)
    {
        Send(new JsonObject { ["id"] = null, ["error"] = new JsonObject { ["code"] = -32700, ["message"] = "Invalid JSON" } });
        continue;
    }
    var method = (string?)message["method"];
    if (method == "exit") break;
    if (message["id"] is not { } id) continue;
    var response = new JsonObject { ["id"] = id.DeepClone() };
    try
    {
        response["result"] = await HandleAsync(method ?? "", message["params"] as JsonObject ?? []);
    }
    catch (MissingMethodException)
    {
        response["error"] = new JsonObject { ["code"] = -32601, ["message"] = $"Unknown method {method}" };
    }
    catch (Exception ex)
    {
        response["error"] = new JsonObject { ["code"] = -32603, ["message"] = ex.Message };
    }
    Send(response);
}
