# Duke Energy Daily Collection Script
$ErrorActionPreference = "Continue"  # Changed from "Stop" to see more output

# Change to the collector directory
Set-Location "C:\Users\joshu\Documents\scripts\duke-energy-project\collector"

# Log file for troubleshooting
$LogFile = "C:\Users\joshu\Documents\scripts\duke-energy-project\collector\daily-run.log"
$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

try {
    # Log start
    "[$Timestamp] Starting Duke Energy data collection..." | Out-File $LogFile -Append
    
    # Add Bun to PATH for this session
    $BunPath = "$env:USERPROFILE\.bun\bin"
    if (Test-Path $BunPath) {
        $env:PATH = "$BunPath;$env:PATH"
    }
    
    # Check if bun is now available
    $BunExe = Get-Command "bun" -ErrorAction SilentlyContinue
    if (-not $BunExe) {
        throw "Bun executable not found. Please check installation."
    }
    
    "[$Timestamp] Found Bun at: $($BunExe.Source)" | Out-File $LogFile -Append
    "[$Timestamp] Current directory: $(Get-Location)" | Out-File $LogFile -Append
    "[$Timestamp] Running data collection..." | Out-File $LogFile -Append
    
    # Run the collector and capture ALL output
    $Output = & bun run collect 2>&1
    $ExitCode = $LASTEXITCODE
    
    # Log all output
    "[$Timestamp] Command output:" | Out-File $LogFile -Append
    $Output | Out-File $LogFile -Append
    "[$Timestamp] Exit code: $ExitCode" | Out-File $LogFile -Append
    
    if ($ExitCode -eq 0) {
        $EndTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        "[$EndTime] Collection completed successfully" | Out-File $LogFile -Append
        exit 0
    } else {
        $EndTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        "[$EndTime] Collection failed with exit code: $ExitCode" | Out-File $LogFile -Append
        exit $ExitCode
    }
    
} catch {
    $ErrorTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$ErrorTime] SCRIPT ERROR: $($_.Exception.Message)" | Out-File $LogFile -Append
    "[$ErrorTime] Full error: $($_)" | Out-File $LogFile -Append
    exit 1
}