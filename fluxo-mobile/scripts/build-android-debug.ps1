$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$androidDir = Join-Path $projectRoot 'android'
$apkPath = Join-Path $androidDir 'app\build\outputs\apk\debug\app-debug.apk'

function First-ExistingPath($paths) {
  foreach ($path in $paths) {
    if ($path -and (Test-Path -LiteralPath $path)) {
      return $path
    }
  }
  return $null
}

$javaHome = First-ExistingPath @(
  $env:JAVA_HOME,
  'C:\Program Files\Android\Android Studio\jbr'
)

if (-not $javaHome) {
  throw 'Java não encontrado. Instale o Android Studio ou configure JAVA_HOME.'
}

$androidHome = First-ExistingPath @(
  $env:ANDROID_HOME,
  $env:ANDROID_SDK_ROOT,
  (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
)

if (-not $androidHome) {
  throw 'Android SDK não encontrado. Abra o Android Studio e instale o SDK.'
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $androidHome
$env:ANDROID_SDK_ROOT = $androidHome
$env:Path = "$javaHome\bin;$androidHome\platform-tools;$env:Path"

Push-Location $projectRoot
try {
  & node scripts/prepare-assets.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar os arquivos.' }
  & npx.cmd cap sync android
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao sincronizar o Android.' }
} finally {
  Pop-Location
}

Push-Location $androidDir
try {
  & .\gradlew.bat assembleDebug
  if ($LASTEXITCODE -ne 0) { throw 'A compilacao falhou. Nenhum APK novo foi gerado.' }
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $apkPath)) {
  throw "APK não encontrado em $apkPath"
}

Write-Host "APK gerado em: $apkPath"
$deliveryDir = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $deliveryDir -Force | Out-Null
$deliveryApk = Join-Path $deliveryDir 'Fluxo-Mobile-2.0.0.apk'
Copy-Item -LiteralPath $apkPath -Destination $deliveryApk -Force
Write-Host "Pronto para instalar: $deliveryApk"
