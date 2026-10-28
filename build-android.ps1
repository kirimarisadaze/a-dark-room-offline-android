param(
    [string]$JavaHome,
    [string]$AndroidSdk,
    [string]$Python,
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = $PSScriptRoot
$localRoot = Join-Path $projectRoot '.local'
$distRoot = Join-Path $projectRoot 'dist'
$apkPath = Join-Path $distRoot 'a-dark-room-offline.apk'

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed (exit $LASTEXITCODE): $Program"
    }
}

function Find-ToolRoot {
    param([string[]]$Candidates, [string]$RequiredFile, [string]$Description)
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate $RequiredFile) -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "Cannot find $Description. Pass its path with the corresponding -JavaHome or -AndroidSdk argument."
}

$javaCommand = Get-Command javac.exe -ErrorAction SilentlyContinue
$pathJavaHome = if ($javaCommand) { Split-Path (Split-Path $javaCommand.Source -Parent) -Parent } else { $null }
$siblingTools = Join-Path (Split-Path $projectRoot -Parent) 'kubi\.tools'
$jdkRoot = Find-ToolRoot @(
    $JavaHome,
    $env:JAVA_HOME,
    (Join-Path $projectRoot '.tools\jdk'),
    (Join-Path $localRoot 'jdk'),
    $pathJavaHome,
    (Join-Path $siblingTools 'jdk')
) 'bin\javac.exe' 'a JDK (17 or newer recommended)'
$sdkRoot = Find-ToolRoot @(
    $AndroidSdk,
    $env:ANDROID_SDK_ROOT,
    $env:ANDROID_HOME,
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
    (Join-Path $projectRoot '.tools\sdk'),
    (Join-Path $localRoot 'sdk'),
    (Join-Path $siblingTools 'sdk')
) 'platforms\android-35\android.jar' 'an Android SDK containing platforms;android-35'

$buildToolsRoot = Join-Path $sdkRoot 'build-tools'
$buildTools = Join-Path $buildToolsRoot '35.0.0'
if (-not (Test-Path -LiteralPath (Join-Path $buildTools 'aapt2.exe') -PathType Leaf)) {
    $installedVersions = @(Get-ChildItem -LiteralPath $buildToolsRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' -and [version]$_.Name -ge [version]'35.0.0' } |
        Sort-Object { [version]$_.Name } -Descending)
    if ($installedVersions.Count -eq 0) { throw 'Android SDK Build Tools 35.0.0 or newer are required.' }
    $buildTools = $installedVersions[0].FullName
}

$java = Join-Path $jdkRoot 'bin\java.exe'
$javac = Join-Path $jdkRoot 'bin\javac.exe'
$jar = Join-Path $jdkRoot 'bin\jar.exe'
$keytool = Join-Path $jdkRoot 'bin\keytool.exe'
$androidJar = Join-Path $sdkRoot 'platforms\android-35\android.jar'
$aapt2 = Join-Path $buildTools 'aapt2.exe'
$zipalign = Join-Path $buildTools 'zipalign.exe'
$d8Jar = Join-Path $buildTools 'lib\d8.jar'
$apksignerJar = Join-Path $buildTools 'lib\apksigner.jar'
foreach ($requiredFile in @($java, $javac, $jar, $keytool, $androidJar, $aapt2, $zipalign, $d8Jar, $apksignerJar)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) { throw "Missing build tool: $requiredFile" }
}

if ($Python) {
    $pythonProgram = $Python
    $pythonPrefix = @()
} else {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        $pythonProgram = $pythonCommand.Source
        $pythonPrefix = @()
    } else {
        $pythonCommand = Get-Command py.exe -ErrorAction SilentlyContinue
        if (-not $pythonCommand) { throw 'Python 3 is required for bundling and verifying game assets. Pass -Python with its executable path.' }
        $pythonProgram = $pythonCommand.Source
        $pythonPrefix = @('-3')
    }
}
$assemblyScript = Join-Path $projectRoot 'scripts\assemble-android-apk.py'

function Test-OfflineApk {
    if (-not (Test-Path -LiteralPath $apkPath -PathType Leaf)) { throw "APK does not exist: $apkPath" }
    Invoke-Checked $pythonProgram ($pythonPrefix + @($assemblyScript, 'verify', $apkPath))
    $verification = @(& $java -jar $apksignerJar verify --verbose --print-certs $apkPath)
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $verification | ForEach-Object { Write-Output $_ }
    $verificationText = $verification -join "`n"
    if ($verificationText -notmatch 'Verified using v1 scheme[^\r\n]*: true' -or
        $verificationText -notmatch 'Verified using v2 scheme[^\r\n]*: true') {
        throw 'APK must have valid v1 and v2 signatures.'
    }
    Invoke-Checked $zipalign @('-c', '4', $apkPath)
    $permissions = @(& $aapt2 dump permissions $apkPath)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect APK permissions.' }
    if (($permissions -join "`n") -match 'android\.permission\.INTERNET') {
        throw 'Offline APK unexpectedly declares INTERNET permission.'
    }
    Write-Host 'Verified: v1/v2 signatures, ZIP alignment, and no INTERNET permission.'
}

if ($VerifyOnly) {
    Test-OfflineApk
    exit 0
}

$prepareScript = Join-Path $projectRoot 'scripts\prepare-android-assets.py'
if (-not (Test-Path -LiteralPath $prepareScript -PathType Leaf)) { throw "Missing asset preparation script: $prepareScript" }
Push-Location -LiteralPath $projectRoot
try {
    Invoke-Checked $pythonProgram ($pythonPrefix + @($prepareScript))
} finally {
    Pop-Location
}

$appRoot = Join-Path $projectRoot 'android\app\src\main'
$manifestPath = Join-Path $appRoot 'AndroidManifest.xml'
$sourceRoot = Join-Path $appRoot 'java'
$resourceRoot = Join-Path $appRoot 'res'
$assetRoot = Join-Path $appRoot 'assets'
foreach ($requiredInput in @($manifestPath, $sourceRoot, $assetRoot)) {
    if (-not (Test-Path -LiteralPath $requiredInput)) { throw "Missing app input: $requiredInput" }
}
if (@(Get-ChildItem -LiteralPath $assetRoot -File -Recurse).Count -eq 0) { throw 'Bundled game assets are empty.' }

# Each invocation keeps its own intermediate directory; no existing build is deleted.
$buildRoot = Join-Path $localRoot ('build\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
$generatedRoot = Join-Path $buildRoot 'generated'
$classRoot = Join-Path $buildRoot 'classes'
$dexRoot = Join-Path $buildRoot 'dex'
New-Item -ItemType Directory -Path $buildRoot, $generatedRoot, $classRoot, $dexRoot, $distRoot -Force | Out-Null
$compiledResources = Join-Path $buildRoot 'resources.zip'
$resourceApk = Join-Path $buildRoot 'resources.apk'
$unsignedApk = Join-Path $buildRoot 'unsigned.apk'
$alignedApk = Join-Path $buildRoot 'aligned.apk'

$linkArguments = @('link', '-o', $resourceApk, '--manifest', $manifestPath, '-I', $androidJar,
    '--java', $generatedRoot, '--min-sdk-version', '23', '--target-sdk-version', '35')
if ((Test-Path -LiteralPath $resourceRoot) -and @(Get-ChildItem -LiteralPath $resourceRoot -File -Recurse).Count -gt 0) {
    Invoke-Checked $aapt2 @('compile', '--dir', $resourceRoot, '-o', $compiledResources)
    $linkArguments += $compiledResources
}
Invoke-Checked $aapt2 $linkArguments

$javaSources = @((Get-ChildItem -LiteralPath $sourceRoot -Filter '*.java' -File -Recurse).FullName)
$javaSources += @((Get-ChildItem -LiteralPath $generatedRoot -Filter '*.java' -File -Recurse).FullName)
if ($javaSources.Count -eq 0) { throw 'No Java sources found.' }
Invoke-Checked $javac (@('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-Xlint:-options',
    '-classpath', $androidJar, '-d', $classRoot) + $javaSources)
$classesJar = Join-Path $buildRoot 'classes.jar'
Invoke-Checked $jar @('cf', $classesJar, '-C', $classRoot, '.')
Invoke-Checked $java @('-cp', $d8Jar, 'com.android.tools.r8.D8', '--release', '--min-api', '23',
    '--lib', $androidJar, '--output', $dexRoot, $classesJar)
# Explicit POSIX names avoid Windows aapt2 -A producing backslashes in ZIP entries.
Invoke-Checked $pythonProgram ($pythonPrefix + @($assemblyScript, 'pack', '--resources', $resourceApk,
    '--assets', $assetRoot, '--dex', (Join-Path $dexRoot 'classes.dex'), '--output', $unsignedApk))
Invoke-Checked $zipalign @('-f', '4', $unsignedApk, $alignedApk)

# Preserve both files privately for future installable updates. Never distribute them.
$signingRoot = Join-Path $localRoot 'signing'
$keystorePath = Join-Path $signingRoot 'a-dark-room-offline.jks'
$passwordPath = Join-Path $signingRoot 'keystore-password.txt'
New-Item -ItemType Directory -Path $signingRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $keystorePath -PathType Leaf)) {
    if (-not (Test-Path -LiteralPath $passwordPath -PathType Leaf)) {
        $randomBytes = New-Object byte[] 32
        $randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $randomGenerator.GetBytes($randomBytes) } finally { $randomGenerator.Dispose() }
        $password = [Convert]::ToBase64String($randomBytes)
        [System.IO.File]::WriteAllText($passwordPath, ($password + [Environment]::NewLine), [System.Text.Encoding]::ASCII)
    }
    Invoke-Checked $keytool @('-genkeypair', '-keystore', $keystorePath, '-storetype', 'JKS',
        '-storepass:file', $passwordPath, '-keypass:file', $passwordPath, '-alias', 'adarkroom-offline',
        '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000',
        '-dname', 'CN=A Dark Room Offline, OU=Android, O=Local Build, C=CN', '-noprompt')
}
if (-not (Test-Path -LiteralPath $passwordPath -PathType Leaf)) { throw 'Existing signing key password is missing. Restore .local/signing from your private backup.' }
Invoke-Checked $java @('-jar', $apksignerJar, 'sign', '--ks', $keystorePath,
    '--ks-key-alias', 'adarkroom-offline', '--ks-pass', ('file:' + $passwordPath),
    '--min-sdk-version', '23', '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
    '--v3-signing-enabled', 'true', '--v4-signing-enabled', 'false', '--out', $apkPath, $alignedApk)
Test-OfflineApk

$sha256 = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumPath = $apkPath + '.sha256'
[System.IO.File]::WriteAllText($checksumPath, ($sha256 + '  ' + (Split-Path $apkPath -Leaf) + [Environment]::NewLine), [System.Text.Encoding]::ASCII)
Get-Item -LiteralPath $apkPath | Select-Object FullName, Length
Write-Host "SHA256: $sha256"
Write-Host "Built: $apkPath"
