param([switch]$SkipWeb)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    if (-not $SkipWeb) {
        if (-not (Test-Path -LiteralPath 'web/node_modules')) {
            Push-Location web
            try {
                if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { & npm.cmd ci }
                elseif (Test-Path -LiteralPath '../.tooling/package/bin/npm-cli.js') { & node ../.tooling/package/bin/npm-cli.js ci }
                else { throw '请安装 Node.js 22.12+（包含 npm），然后重新运行。' }
                if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败。' }
            } finally { Pop-Location }
        }
        & node scripts/build-web.mjs
        if ($LASTEXITCODE -ne 0) { throw '前端构建失败。' }
    }
    $bundledJdk = Join-Path $projectRoot '.tooling/jdk/jdk-17.0.13+11'
    if (-not $env:JAVA_HOME -and (Test-Path -LiteralPath $bundledJdk)) { $env:JAVA_HOME = $bundledJdk }
    if (-not $env:GRADLE_USER_HOME) { $env:GRADLE_USER_HOME = Join-Path $projectRoot '.gradle-home' }
    if (-not (Test-Path -LiteralPath '.signing/jianliao-preview.keystore')) {
        throw '缺少原版签名：请恢复 .signing/jianliao-preview.keystore，不能生成新的签名替代。'
    }
    $localGradle = Join-Path $projectRoot '.tooling/gradle-8.7/bin/gradle.bat'
    if (Test-Path -LiteralPath $localGradle) {
        & $localGradle --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --console=plain
    } else {
        & ./gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --console=plain
    }
    if ($LASTEXITCODE -ne 0) { throw 'Android 构建失败。' }
    New-Item -ItemType Directory -Force -Path artifacts | Out-Null
    $version = ((Get-Content -LiteralPath 'version.properties' | Where-Object { $_ -match '^versionName=' }) -replace '^versionName=', '').Trim()
    $apkName = 'jianliao-' + $version + '-preview.apk'
    $apk = Join-Path $projectRoot ('artifacts/' + $apkName)
    Copy-Item -LiteralPath 'app/build/outputs/apk/debug/app-debug.apk' -Destination $apk -Force
    $hash = Get-FileHash -LiteralPath $apk -Algorithm SHA256
    ($hash.Hash.ToLower() + '  ' + $apkName) | Set-Content -LiteralPath ($apk + '.sha256') -Encoding ascii
    & node scripts/prepare-release.mjs --verify-only --apk $apk
    if ($LASTEXITCODE -ne 0) { throw '安装包版本或签名校验失败。' }
    Write-Host ('APK: ' + $apk)
} finally { Pop-Location }
