$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localBuildTools = Join-Path $projectRoot '.apk-build'

if (-not $env:JAVA_HOME) {
    $bundledJava = Join-Path $localBuildTools 'jdk\jdk-21.0.13+9'
    if (Test-Path (Join-Path $bundledJava 'bin\java.exe')) { $env:JAVA_HOME = $bundledJava }
}
if (-not $env:ANDROID_HOME) {
    $bundledSdk = Join-Path $localBuildTools 'android-sdk'
    if (Test-Path (Join-Path $bundledSdk 'platforms\android-35')) { $env:ANDROID_HOME = $bundledSdk }
}
if (-not $env:ANDROID_SDK_ROOT -and $env:ANDROID_HOME) { $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME }
if (-not $env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = Join-Path $localBuildTools 'gradle-home' }

Push-Location $projectRoot
try {
    $webFiles = @('index.html','app.js','styles.css','manifest.webmanifest','sw.js')
    foreach ($file in $webFiles) { Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $projectRoot "www\$file") -Force }
    $webIcons = Join-Path $projectRoot 'www\icons'
    New-Item -ItemType Directory -Path $webIcons -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'icons') | Copy-Item -Destination $webIcons -Recurse -Force
    $webBrand = Join-Path $projectRoot 'www\assets\brand'
    New-Item -ItemType Directory -Path $webBrand -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'assets\brand\smart_studymate_logo_transparent.png') -Destination $webBrand -Force
    & npx.cmd cap sync android
    if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }
    Push-Location (Join-Path $projectRoot 'android')
    try {
        & .\gradlew.bat assembleDebug --no-daemon
        if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    } finally { Pop-Location }
    $builtApk = Join-Path $projectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
    Copy-Item -LiteralPath $builtApk -Destination (Join-Path $projectRoot 'StudyMate.apk') -Force
    Write-Host "APK ready: $(Join-Path $projectRoot 'StudyMate.apk')"
} finally { Pop-Location }
