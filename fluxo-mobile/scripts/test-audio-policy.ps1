$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSCommandPath -Parent) -Parent
$java = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:\Program Files\Android\Android Studio\jbr' }
$out = "$root\.qa\audio-policy"
New-Item -ItemType Directory -Path $out -Force | Out-Null
& "$java\bin\javac.exe" -d $out "$root\android\app\src\main\java\com\fluxo\music\mobile\PlaybackAuthorization.java" "$root\tests\fixtures\PlaybackAuthorizationTest.java"
if ($LASTEXITCODE) { throw 'Audio policy compilation failed' }
& "$java\bin\java.exe" -cp $out com.fluxo.music.mobile.PlaybackAuthorizationTest
if ($LASTEXITCODE) { throw 'Audio policy test failed' }
