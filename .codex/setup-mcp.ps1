param([switch]$Force, [switch]$ImportClaudePixelLab)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$configPath = Join-Path $PSScriptRoot 'config.toml'
$runnerPath = Join-Path $projectRoot 'tools/content-forge/node_modules/tsx/dist/cli.mjs'
$serverPath = Join-Path $projectRoot 'tools/content-forge/src/server.ts'

if ((Test-Path -LiteralPath $configPath) -and -not $Force) {
    throw 'config.toml already exists. Review it before explicitly regenerating with -Force.'
}
if (-not (Test-Path -LiteralPath $runnerPath)) {
    throw 'Install Content Forge first: npm --prefix tools/content-forge ci'
}
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$npxPath = (Get-Command npx.cmd -ErrorAction Stop).Source
$nodeVersion = & $nodePath -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.13.0') {
    throw 'Content Forge needs Node 22.13 or newer.'
}

function ConvertTo-TomlPath([string]$Value) {
    return ConvertTo-Json -InputObject ($Value.Replace('\', '/')) -Compress
}

$rootValue = ConvertTo-TomlPath $projectRoot
$nodeValue = ConvertTo-TomlPath $nodePath
$npxValue = ConvertTo-TomlPath $npxPath
$runnerValue = ConvertTo-TomlPath $runnerPath
$serverValue = ConvertTo-TomlPath $serverPath
$config = @"
# Generated for this checkout; keep local. Regenerate after moving the project.
[mcp_servers.content-forge]
command = $nodeValue
args = [$runnerValue, $serverValue]
cwd = $rootValue
startup_timeout_sec = 30
tool_timeout_sec = 120

[mcp_servers.chrome-devtools]
command = $npxValue
args = ["-y", "chrome-devtools-mcp@latest"]
cwd = $rootValue
startup_timeout_sec = 60
tool_timeout_sec = 120
"@
if ($ImportClaudePixelLab) {
    $claudeConfigPath = Join-Path $env:USERPROFILE '.claude.json'
    $pixelLabJson = & $nodePath -e 'const fs = require("node:fs"); const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(JSON.stringify(c.mcpServers?.pixellab ?? null));' $claudeConfigPath
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not read the local Claude PixelLab connection.'
    }
    $pixelLab = $pixelLabJson | ConvertFrom-Json
    if ($pixelLab.type -ne 'http' -or $pixelLab.url -ne 'https://api.pixellab.ai/mcp' -or
        $pixelLab.headers.Authorization -notlike 'Bearer *') {
        throw 'No supported PixelLab HTTP connection found in local Claude configuration.'
    }
    $authValue = ConvertTo-Json -InputObject ([string]$pixelLab.headers.Authorization) -Compress
    $config += @"


[mcp_servers.pixellab]
url = "https://api.pixellab.ai/mcp"
startup_timeout_sec = 30
tool_timeout_sec = 120

[mcp_servers.pixellab.http_headers]
Authorization = $authValue
"@
}
[System.IO.File]::WriteAllText($configPath, $config + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Output 'Project MCP configuration created. Restart Codex and check codex mcp list.'
