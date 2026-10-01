$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$buildScript = Join-Path $projectRoot 'scripts\build-android-debug.ps1'
$apkPath = Join-Path $projectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'

& $buildScript

$adbPath = $null
$adbCandidates = @()
if ($env:ANDROID_HOME) { $adbCandidates += (Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe') }
if ($env:ANDROID_SDK_ROOT) { $adbCandidates += (Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe') }
if ($env:LOCALAPPDATA) { $adbCandidates += (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe') }

foreach ($candidate in $adbCandidates) {
  if ($candidate -and (Test-Path -LiteralPath $candidate)) {
    $adbPath = $candidate
    break
  }
}

if (-not $adbPath) {
  throw 'adb não encontrado. Instale o Android SDK Platform Tools pelo Android Studio.'
}

& $adbPath devices
& $adbPath install -r $apkPath
if ($LASTEXITCODE -ne 0) { throw 'A instalacao falhou. Confira a conexao USB e a autorizacao no celular.' }
