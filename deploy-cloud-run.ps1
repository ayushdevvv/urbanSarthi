$ErrorActionPreference = 'Stop'

function Invoke-Gcloud {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ArgsList)
    & gcloud @ArgsList
    if ($LASTEXITCODE -ne 0) { throw "gcloud command failed: gcloud $($ArgsList -join ' ')" }
}

function Set-SecretVersion {
    param([string]$Project, [string]$Name, [string]$Prompt, [switch]$Optional)
    $valueSecure = Read-Host $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($valueSecure)
    $value = ''
    $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) ("urbansaarthi-" + [guid]::NewGuid().ToString('N') + '.secret')
    try {
        $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        if ([string]::IsNullOrWhiteSpace($value)) {
            if ($Optional) { Write-Host "Skipping optional secret $Name" -ForegroundColor Yellow; return }
            throw "$Name cannot be empty."
        }
        [System.IO.File]::WriteAllText($tempFile, $value, [System.Text.UTF8Encoding]::new($false))
        & gcloud secrets describe $Name --project $Project *> $null
        if ($LASTEXITCODE -ne 0) { Invoke-Gcloud secrets create $Name --replication-policy=automatic --project $Project }
        Invoke-Gcloud secrets versions add $Name "--data-file=$tempFile" --project $Project
    }
    finally {
        if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
        if (Test-Path $tempFile) { Remove-Item -Force $tempFile }
        $value = $null
        $valueSecure = $null
    }
}

Write-Host "UrbanSaarthi · Google Cloud Run deployment" -ForegroundColor Green
Write-Host "This deploys the existing React + FastAPI application as one Cloud Run service. Docker is built by Google Cloud Build; it is not needed locally."

$project = Read-Host "Google Cloud project ID"
if ([string]::IsNullOrWhiteSpace($project)) { throw 'A Google Cloud project ID is required.' }
$region = Read-Host "Cloud Run region [asia-south1]"
if ([string]::IsNullOrWhiteSpace($region)) { $region = 'asia-south1' }

Invoke-Gcloud auth list
Invoke-Gcloud config set project $project
Invoke-Gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com --project $project

# Source deployments use Cloud Build. Grant the documented builder role to the
# project's default Compute Engine build identity so first-time deploys can build.
$projectNumber = (& gcloud projects describe $project --format='value(projectNumber)').Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($projectNumber)) { throw 'Could not resolve the Google Cloud project number.' }
$buildServiceAccount = "$projectNumber-compute@developer.gserviceaccount.com"
Invoke-Gcloud projects add-iam-policy-binding $project "--member=serviceAccount:$buildServiceAccount" --role=roles/run.builder --condition=None

Write-Host "`nAdd the SAME production database URL used by your current deployment. It must be reachable from Google Cloud Run; an internal-only Render hostname will not work." -ForegroundColor Yellow
Set-SecretVersion -Project $project -Name 'urbansaarthi-database-url' -Prompt 'Existing external PostgreSQL DATABASE_URL'
Set-SecretVersion -Project $project -Name 'urbansaarthi-gemini-api-key' -Prompt 'Google AI Studio GEMINI_API_KEY'
Set-SecretVersion -Project $project -Name 'urbansaarthi-ingestion-api-key' -Prompt 'Existing INGESTION_API_KEY (32+ characters)'

$serviceAccount = "urbansaarthi-runtime@$project.iam.gserviceaccount.com"
& gcloud iam service-accounts describe $serviceAccount --project $project *> $null
if ($LASTEXITCODE -ne 0) { Invoke-Gcloud iam service-accounts create urbansaarthi-runtime --display-name 'UrbanSaarthi Cloud Run runtime' --project $project }
Invoke-Gcloud projects add-iam-policy-binding $project "--member=serviceAccount:$serviceAccount" --role=roles/secretmanager.secretAccessor --condition=None

Write-Host "`nDeploying. Cloud Build compiles the frontend and builds the runtime image from the root Dockerfile." -ForegroundColor Green
Invoke-Gcloud run deploy urbansaarthi `
  --source . `
  --region $region `
  --platform managed `
  --allow-unauthenticated `
  --service-account $serviceAccount `
  --port 8080 `
  --cpu 2 `
  --memory 4Gi `
  --concurrency 1 `
  --max-instances 2 `
  --min 0 `
  --timeout 900 `
  --set-env-vars 'APP_ENV=production,API_V1_PREFIX=/api/v1,TIMEZONE=Asia/Kolkata,CORS_ORIGINS=https://urbansarthi.vercel.app,GOOGLE_AI_PRIMARY_MODEL=gemini-3.8-flash,GOOGLE_AI_FALLBACK_MODEL=gemma-4-26b-a4b-it,GOOGLE_AI_TIMEOUT_SECONDS=12' `
  --set-secrets 'DATABASE_URL=urbansaarthi-database-url:latest,GEMINI_API_KEY=urbansaarthi-gemini-api-key:latest,INGESTION_API_KEY=urbansaarthi-ingestion-api-key:latest' `
  --project $project

$url = (& gcloud run services describe urbansaarthi --region $region --project $project --format='value(status.url)').Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($url)) { throw 'Deployment command completed but the service URL could not be read.' }
Write-Host "`nDeployment URL: $url" -ForegroundColor Green
Write-Host "Health check: $url/healthz"
Write-Host "API: $url/api/v1"
Write-Host "`nNext: verify /healthz, /readyz, Traffic Lab image analysis and the Traffic Agent before switching the custom domain or retiring the existing Render service." -ForegroundColor Yellow
