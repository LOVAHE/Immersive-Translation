using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

namespace AdaptiveTranslation.CodexCompanion
{
    public static class NativeHostLauncher
    {
        private static string QuoteArgument(string value)
        {
            if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            {
                return value;
            }

            var result = new StringBuilder();
            result.Append('"');
            var backslashes = 0;
            foreach (var character in value)
            {
                if (character == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (character == '"')
                {
                    result.Append('\\', backslashes * 2 + 1);
                    result.Append('"');
                    backslashes = 0;
                    continue;
                }
                result.Append('\\', backslashes);
                backslashes = 0;
                result.Append(character);
            }
            result.Append('\\', backslashes * 2);
            result.Append('"');
            return result.ToString();
        }

        public static int Main(string[] args)
        {
            try
            {
                var executableDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                if (String.IsNullOrWhiteSpace(executableDirectory))
                {
                    throw new InvalidOperationException();
                }
                var companionDirectoryInfo = Directory.GetParent(executableDirectory);
                if (companionDirectoryInfo == null)
                {
                    throw new InvalidOperationException();
                }
                var companionDirectory = companionDirectoryInfo.FullName;
                var nodePathFile = Path.Combine(companionDirectory, "node-path.txt");
                var hostPath = Path.Combine(companionDirectory, "host.mjs");
                var nodePath = File.ReadAllText(nodePathFile).Trim();
                if (!File.Exists(nodePath) || !File.Exists(hostPath))
                {
                    throw new FileNotFoundException();
                }

                var arguments = new StringBuilder(QuoteArgument(hostPath));
                foreach (var argument in args)
                {
                    arguments.Append(' ');
                    arguments.Append(QuoteArgument(argument));
                }

                var startInfo = new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = arguments.ToString(),
                    WorkingDirectory = companionDirectory,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardInput = false,
                    RedirectStandardOutput = false,
                    RedirectStandardError = false
                };
                using (var process = Process.Start(startInfo))
                {
                    if (process == null)
                    {
                        throw new InvalidOperationException();
                    }
                    process.WaitForExit();
                    return process.ExitCode;
                }
            }
            catch
            {
                Console.Error.WriteLine("Adaptive Translation native host failed to start.");
                return 1;
            }
        }
    }
}
