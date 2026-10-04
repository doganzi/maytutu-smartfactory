<#
.SYNOPSIS
  NMD-530 수집기를 작업 스케줄러에 등록한다 (계약서 docs/NMD530_PIPELINE.md §8 Windows).
.DESCRIPTION
  - 앱 파일 3개(nmd530-codec.js · nmd530-counter.js · nmd530-bridge.js)를 C:\ProgramData\maytutu\nmd530\app 으로 복사
  - 설정·토큰은 C:\ProgramData\maytutu\nmd530\config.json (폴더 ACL 에서 일반 Users 읽기 제거)
  - 작업 «Maytutu-NMD530-Bridge»: 시작 시(지연 60초) · 실패 시 1분 뒤 재시작(최대치) · 배터리에서도 시작/유지 · 중복 실행 무시 · 실행 시간 제한 없음
  - 이미 설치돼 있으면 설정을 덮어쓰기 전에 실행 중인 작업을 먼저 멈춘다(수집기는 설정을 시작할 때 한 번만 읽는다).
  - 기본은 등록 뒤 바로 시작한다. -NoStart 는 등록만 하고 시작하지 않는다(--dry 시험을 먼저 할 때).
  - 주소(-Endpoint)를 안 주면 입력창으로 묻는다. 입력이 불가능한 환경이면 안내 뒤 종료 코드 1.
  토큰은 매개변수로 받지 않는다(명령 기록에 남음) — 실행 중 Read-Host 로만 입력한다.
  -WhatIf 는 변경 없이 하려는 일만 출력한다(주소는 똑같이 묻는다). -Remove 는 작업과 앱 폴더를 지운다(설정·상태 폴더는 남김).
  전원 설정(절전·덮개·업데이트 재시작)은 이 스크립트가 바꾸지 않는다 — 가이드 §1 의 사전 점검으로 사람이 확인한다.
.EXAMPLE
  .\nmd530-bridge-install.ps1 -SourceDir C:\nmd530-src -NoStart
#>
#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Endpoint,
    [string]$Device = 'NMD530-1',
    [string]$DetectorHost = '192.168.0.5',
    [int]$DetectorPort = 8000,
    [string]$SourceDir,
    [switch]$NoStart,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Maytutu-NMD530-Bridge'
$Root     = Join-Path $env:ProgramData 'maytutu\nmd530'
$AppDir   = Join-Path $Root 'app'
$DataDir  = Join-Path $Root 'data'
$CfgPath  = Join-Path $Root 'config.json'
$AppFiles = @('nmd530-codec.js', 'nmd530-counter.js', 'nmd530-bridge.js')

# 작업을 멈추고 수집기 프로세스(앱 폴더의 nmd530-bridge.js)가 사라질 때까지 최대 약 10초 기다린다.
# 작업이 없거나 이미 멈춰 있으면 조용히 통과. 끝내 안 죽으면 그 프로세스만 강제 종료. 사라졌으면 $true.
function Stop-BridgeAndWait {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    }
    $pattern = '*' + $AppDir + '*nmd530-bridge.js*'
    for ($i = 0; $i -lt 20; $i++) {
        $procs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like $pattern })
        if ($procs.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 500
    }
    foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
    $left = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like $pattern })
    return ($left.Count -eq 0)
}

# 관리자 권한 확인 — 아니면 안내만 하고 중단(미리보기 -WhatIf 는 변경이 없으니 통과)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    if ($WhatIfPreference) {
        Write-Host '[미리보기] 관리자 권한이 아니라 실제 설치는 되지 않습니다. 변경 없이 하려는 일만 보여줍니다.'
    } else {
        Write-Host '관리자 권한이 필요합니다. PowerShell 을 «관리자 권한으로 실행» 한 뒤 다시 실행하세요.'
        exit 1
    }
}

if ($Remove) {
    $removeFailed = $false
    if ($PSCmdlet.ShouldProcess($TaskName, '작업 중지 후 작업 스케줄러에서 제거')) {
        if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
            # 중지 요청만으로는 node 가 아직 앱 폴더(작업 폴더)를 잡고 있을 수 있어 사라질 때까지 기다린다
            if (-not (Stop-BridgeAndWait)) { Write-Host '수집기 프로세스가 아직 남아 있습니다 — 폴더 삭제가 실패할 수 있습니다.' }
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            Write-Host "작업 제거: $TaskName"
        } else {
            Write-Host "등록된 작업이 없습니다: $TaskName"
        }
    }
    if ($PSCmdlet.ShouldProcess($AppDir, '앱 폴더 삭제')) {
        if (Test-Path -LiteralPath $AppDir) {
            $deleted = $false
            for ($i = 0; $i -lt 5 -and -not $deleted; $i++) {
                try { Remove-Item -LiteralPath $AppDir -Recurse -Force -ErrorAction Stop; $deleted = $true }
                catch { Start-Sleep -Seconds 1 }
            }
            if ($deleted) { Write-Host "앱 폴더 삭제: $AppDir" }
            else {
                $removeFailed = $true
                Write-Host "앱 폴더를 지우지 못했습니다(사용 중). 수동 삭제 필요: $AppDir  — 잠시 뒤 -Remove 를 다시 실행하거나 폴더를 직접 지우세요."
            }
        }
    }
    Write-Host "설정·상태 폴더는 남겼습니다(토큰이 든 config.json 포함): $Root  — 필요하면 폴더째 직접 삭제하세요."
    if ($removeFailed) { exit 1 }
    exit 0
}

# 설치 전 점검
# 주소: 없으면 입력창으로 묻는다(-WhatIf 미리보기도 같은 순서). 입력이 불가능한 환경(-NonInteractive·입력 닫힘)이면 안내 후 종료.
if (-not $Endpoint) {
    try { $Endpoint = Read-Host -Prompt '주소(Endpoint) — 본사가 알려 준 /exec 주소' }
    catch { $Endpoint = '' }
    if ($Endpoint) { $Endpoint = $Endpoint.Trim() }
}
if (-not $Endpoint) {
    Write-Host '-Endpoint <웹앱 /exec 주소> 가 필요합니다(입력창에서도 받지 못했습니다).'
    exit 1
}
if (-not $SourceDir) { $SourceDir = Split-Path -Parent $PSScriptRoot }
$missing = @($AppFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $SourceDir $_)) })
if ($missing.Count -gt 0) {
    Write-Host ("-SourceDir 에 앱 파일이 없습니다: " + ($missing -join ', ') + "  (SourceDir=$SourceDir)")
    exit 1
}
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host 'Node.js 가 설치돼 있지 않습니다. https://nodejs.org 에서 LTS(22 이상)를 설치한 뒤 이 스크립트를 다시 실행하세요.'
    exit 1
}
$NodeExe = $nodeCmd.Source
# 작업은 SYSTEM 계정으로 돈다 — 사용자별 설치(nvm·fnm·Volta 등, C:\Users\... 아래)는 SYSTEM 이 못 쓸 수 있다
if ($NodeExe -match '\\Users\\') {
    Write-Host "경고: node 가 사용자 폴더 아래에 있습니다($NodeExe). 작업(SYSTEM 계정)이 실행하지 못할 수 있어 중단합니다."
    Write-Host '공용 설치(C:\Program Files\nodejs)로 Node.js LTS 를 설치한 뒤, PowerShell 을 새로 열어 다시 실행하세요.'
    exit 1
}
# 수집기는 Node 18 이상을 가정한다(저장소 CI 는 Node 22). 낮은 버전이면 늦게 터지므로 설치 전에 막는다.
$nodeVer = ''
try { $nodeVer = (& $NodeExe --version 2>$null | Select-Object -First 1) } catch { $nodeVer = '' }
if ($nodeVer -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 18) {
    Write-Host "Node.js 버전이 낮거나 확인되지 않습니다(확인값: '$nodeVer'). LTS(22 이상)를 설치한 뒤 다시 실행하세요."
    exit 1
}

# 토큰: 매개변수가 아니라 입력창으로만 받는다(미리보기에서는 묻지 않는다)
# 한계: .NET 문자열은 불변이라 $tokenPlain 을 지워도 메모리에서 즉시 사라지지 않는다(가비지 수집 몫).
#       BSTR 은 ZeroFreeBSTR 로 지운다. 실질 노출 경로는 config.json(ACL 로 제한)뿐이다.
$tokenPlain = ''
if (-not $WhatIfPreference) {
    try { $secure = Read-Host -Prompt '공유 토큰(NMD530_TOKEN) 입력 — 화면에 표시되지 않습니다' -AsSecureString }
    catch { Write-Host '토큰을 입력받지 못해 중단합니다(입력이 불가능한 환경).'; exit 1 }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    # 메신저에서 복사하다 붙은 앞뒤 공백·개행은 서버 auth 거절의 흔한 원인 — 잘라 낸다
    try { $tokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $bstr = [IntPtr]::Zero; $secure.Dispose(); $secure = $null }
    if (-not $tokenPlain) { Write-Host '토큰이 비어 있어 중단합니다.'; exit 1 }
}

# 이미 설치돼 돌고 있으면 설정을 덮어쓰기 전에 멈춘다 — 안 멈추면 옛 프로세스가 옛 토큰·설정으로 계속 돈다
if ($PSCmdlet.ShouldProcess($TaskName, '실행 중인 수집기 중지(재설치 시, 최대 약 10초 대기)')) {
    if (-not (Stop-BridgeAndWait)) { Write-Host '수집기 프로세스를 끝내지 못했습니다. 작업 관리자에서 node.exe 를 종료한 뒤 다시 실행하세요.'; exit 1 }
}

# 폴더 + ACL (SYSTEM · Administrators 만. 일반 Users 읽기 제거)
if ($PSCmdlet.ShouldProcess($Root, '폴더 생성 및 권한 제한(Users 읽기 제거)')) {
    New-Item -ItemType Directory -Force -Path $AppDir, $DataDir | Out-Null
    & icacls.exe $Root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls 실패(코드 $LASTEXITCODE)" }
}

# 앱 파일 복사
foreach ($f in $AppFiles) {
    if ($PSCmdlet.ShouldProcess((Join-Path $AppDir $f), "복사: $SourceDir\$f")) {
        Copy-Item -LiteralPath (Join-Path $SourceDir $f) -Destination (Join-Path $AppDir $f) -Force
    }
}

# 설정 파일(토큰 포함) — BOM 없는 UTF-8
if ($PSCmdlet.ShouldProcess($CfgPath, '설정 파일(config.json) 저장 — 토큰 포함')) {
    $cfg = [ordered]@{
        endpoint = $Endpoint; token = $tokenPlain; device = $Device
        host = $DetectorHost; port = $DetectorPort; stateDir = $DataDir
    }
    [IO.File]::WriteAllText($CfgPath, ($cfg | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    $cfg = $null
}
$tokenPlain = $null   # 한계: 위 설명대로 메모리 사본은 가비지 수집 때까지 남을 수 있다

# 작업 스케줄러
$arg = '"' + (Join-Path $AppDir 'nmd530-bridge.js') + '" --config "' + $CfgPath + '"'
$action    = New-ScheduledTaskAction -Execute $NodeExe -Argument $arg -WorkingDirectory $AppDir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT60S'
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

if ($PSCmdlet.ShouldProcess($TaskName, "작업 등록: 시작 시(지연 60초) · node=$NodeExe")) {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
        -Description 'NMD-530 금속검출기 수집기(메이투투 스마트팩토리)' -Force | Out-Null
    Write-Host "작업 등록 완료: $TaskName"
}
if ($NoStart) {
    Write-Host "-NoStart: 작업을 시작하지 않았습니다. --dry 시험 뒤 시작: Start-ScheduledTask -TaskName $TaskName  (재부팅 때는 자동 시작)"
} elseif ($PSCmdlet.ShouldProcess($TaskName, '작업 지금 시작')) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "시작했습니다. 로그: $DataDir\bridge.log"
}
