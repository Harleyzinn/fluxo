$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSCommandPath -Parent) -Parent
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$java = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:\Program Files\Android\Android Studio\jbr' }
$env:JAVA_HOME = $java
$env:Path = "$java\bin;$env:Path"
$tools = "$sdk\build-tools\36.0.0"
$jar = "$sdk\platforms\android-36\android.jar"
$source = "$root\tests\fixtures\audio-probe"
$out = "$root\.qa\audio-probe"
New-Item -ItemType Directory -Force -Path "$out\classes", "$out\dex" | Out-Null
& "$java\bin\javac.exe" -source 8 -target 8 -classpath $jar -d "$out\classes" "$source\ProbeActivity.java" "$source\ProbeService.java"
if ($LASTEXITCODE) { throw 'Probe compilation failed' }
$classes = @(Get-ChildItem -LiteralPath "$out\classes" -Recurse -Filter '*.class' | ForEach-Object FullName)
& "$tools\d8.bat" --lib $jar --min-api 24 --output "$out\dex" @classes
if ($LASTEXITCODE) { throw 'Probe dex failed' }
& "$tools\aapt.exe" package -f -M "$source\AndroidManifest.xml" -I $jar -F "$out\unsigned.apk"
if ($LASTEXITCODE) { throw 'Probe packaging failed' }
Push-Location "$out\dex"
try { & "$tools\aapt.exe" add "$out\unsigned.apk" classes.dex } finally { Pop-Location }
if ($LASTEXITCODE) { throw 'Probe dex packaging failed' }
& "$tools\zipalign.exe" -f 4 "$out\unsigned.apk" "$out\aligned.apk"
if ($LASTEXITCODE) { throw 'Probe alignment failed' }
& "$tools\apksigner.bat" sign --ks (Join-Path $env:USERPROFILE '.android\debug.keystore') --ks-pass pass:android --out "$out\probe.apk" "$out\aligned.apk"
if ($LASTEXITCODE) { throw 'Probe signing failed' }
Write-Output "$out\probe.apk"
