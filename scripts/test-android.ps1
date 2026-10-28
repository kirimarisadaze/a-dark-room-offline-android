param(
    [string]$JavaHome,
    [string]$AndroidSdk,
    [string]$Serial = 'emulator-5582',
    [string]$TargetApk,
    [switch]$BuildOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path $PSScriptRoot -Parent
$localRoot = Join-Path $projectRoot '.local'
$testRoot = Join-Path $projectRoot 'android\tests'
$outputRoot = Join-Path $localRoot 'native-tests'
$buildRoot = Join-Path $outputRoot ('build-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$siblingTools = Join-Path (Split-Path $projectRoot -Parent) 'kubi\.tools'

function Find-Root([string[]]$Candidates, [string]$Required) {
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate $Required) -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "Missing tool: $Required"
}
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $Program" }
}

$jdkRoot = Find-Root @($JavaHome, $env:JAVA_HOME, (Join-Path $projectRoot '.tools\jdk'),
    (Join-Path $siblingTools 'jdk')) 'bin\javac.exe'
$sdkRoot = Find-Root @($AndroidSdk, $env:ANDROID_SDK_ROOT, $env:ANDROID_HOME,
    (Join-Path $projectRoot '.tools\sdk'), (Join-Path $siblingTools 'sdk')) 'platforms\android-35\android.jar'
$toolsRoot = Join-Path $sdkRoot 'build-tools\35.0.0'
$androidJar = Join-Path $sdkRoot 'platforms\android-35\android.jar'
$java = Join-Path $jdkRoot 'bin\java.exe'
$jar = Join-Path $jdkRoot 'bin\jar.exe'
$classes = Join-Path $buildRoot 'classes'
$dex = Join-Path $buildRoot 'dex'
$unsigned = Join-Path $buildRoot 'unsigned.apk'
$aligned = Join-Path $buildRoot 'aligned.apk'
$testApk = Join-Path $outputRoot 'offline-smoke-tests.apk'
$keystore = Join-Path $localRoot 'signing\a-dark-room-offline.jks'
$password = Join-Path $localRoot 'signing\keystore-password.txt'
if (-not (Test-Path -LiteralPath $keystore)) { throw 'Build the main APK first to create its signing key.' }
New-Item -ItemType Directory -Force $classes, $dex, $outputRoot | Out-Null
Invoke-Checked (Join-Path $toolsRoot 'aapt2.exe') @('link', '-o', $unsigned, '--manifest',
    (Join-Path $testRoot 'AndroidManifest.xml'), '-I', $androidJar, '--min-sdk-version', '23', '--target-sdk-version', '35')
$sources = @((Get-ChildItem (Join-Path $testRoot 'java') -Recurse -File -Filter '*.java').FullName)
Invoke-Checked (Join-Path $jdkRoot 'bin\javac.exe') (@('-encoding', 'UTF-8', '-source', '8', '-target', '8',
    '-Xlint:-options', '-classpath', $androidJar, '-d', $classes) + $sources)
$classesJar = Join-Path $buildRoot 'classes.jar'
Invoke-Checked $jar @('cf', $classesJar, '-C', $classes, '.')
Invoke-Checked $java @('-cp', (Join-Path $toolsRoot 'lib\d8.jar'), 'com.android.tools.r8.D8', '--release',
    '--min-api', '23', '--lib', $androidJar, '--output', $dex, $classesJar)
Invoke-Checked $jar @('uf', $unsigned, '-C', $dex, 'classes.dex')
Invoke-Checked (Join-Path $toolsRoot 'zipalign.exe') @('-f', '4', $unsigned, $aligned)
Invoke-Checked $java @('-jar', (Join-Path $toolsRoot 'lib\apksigner.jar'), 'sign', '--ks', $keystore,
    '--ks-key-alias', 'adarkroom-offline', '--ks-pass', ('file:' + $password), '--min-sdk-version', '23',
    '--v4-signing-enabled', 'false', '--out', $testApk, $aligned)
Invoke-Checked $java @('-jar', (Join-Path $toolsRoot 'lib\apksigner.jar'), 'verify', $testApk)
Write-Host "Built test-only APK: $testApk"
if ($BuildOnly) { exit 0 }

# This runner is intentionally pinned to the separately owned test emulator.
if ($Serial -ne 'emulator-5582') { throw 'Device runs are restricted to dedicated emulator-5582. No other device was touched.' }
$adb = Join-Path $sdkRoot 'platform-tools\adb.exe'
if (-not $TargetApk) { $TargetApk = Join-Path $projectRoot 'dist\a-dark-room-offline.apk' }
if (-not (Test-Path -LiteralPath $TargetApk -PathType Leaf)) { throw "Target APK does not exist: $TargetApk" }
Invoke-Checked $adb @('-s', $Serial, 'get-state')
Invoke-Checked $adb @('-s', $Serial, 'install', '-r', $TargetApk)
Invoke-Checked $adb @('-s', $Serial, 'install', '-r', $testApk)
$runOutput = @(& $adb -s $Serial shell am instrument -w -r 'org.adarkroom.offline.tests/org.adarkroom.offline.tests.OfflineSmoke')
$runOutput | ForEach-Object { Write-Output $_ }
$runOutput | Set-Content -LiteralPath (Join-Path $outputRoot 'instrumentation.txt') -Encoding UTF8
$reportLine = @($runOutput | Where-Object { $_ -match '^INSTRUMENTATION_RESULT: report=' })
if ($reportLine.Count -eq 0) { throw 'Instrumentation did not emit a report. See .local/native-tests/instrumentation.txt.' }
$json = $reportLine[-1] -replace '^INSTRUMENTATION_RESULT: report=', ''
$parsed = $json | ConvertFrom-Json
[System.IO.File]::WriteAllText((Join-Path $outputRoot 'native-report.json'), $json, [System.Text.Encoding]::UTF8)
if (-not $parsed.passed) { throw 'Native smoke tests failed. See .local/native-tests/native-report.json.' }
Write-Host 'Native smoke tests passed; the captured original game progress was restored.'
