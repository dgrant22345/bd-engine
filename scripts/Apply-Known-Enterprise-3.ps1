$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"

$knownMappings = @(
    @{ pattern = '^abbott$'; atsType = 'workday'; boardUrl = 'https://abbott.wd5.myworkdayjobs.com/Careers'; boardId = 'abbott' }
    @{ pattern = '^cushman and wakefield'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.cushmanwakefield.com/'; boardId = 'cushmanwakefield' }
    @{ pattern = '^cvs health'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.cvshealth.com/'; boardId = 'cvshealth' }
    @{ pattern = '^diebold nixdorf'; atsType = 'custom_enterprise'; boardUrl = 'https://www.dieboldnixdorf.com/en-us/careers/'; boardId = 'dieboldnixdorf' }
    @{ pattern = '^dp world'; atsType = 'custom_enterprise'; boardUrl = 'https://www.dpworld.com/careers'; boardId = 'dpworld' }
    @{ pattern = '^fdm group'; atsType = 'custom_enterprise'; boardUrl = 'https://www.fdmgroup.com/careers/'; boardId = 'fdm' }
    @{ pattern = '^flight centre'; atsType = 'custom_enterprise'; boardUrl = 'https://www.fctgl.com/careers/'; boardId = 'flightcentre' }
    @{ pattern = '^fujitsu'; atsType = 'custom_enterprise'; boardUrl = 'https://fujitsu.wd3.myworkdayjobs.com/Fujitsu_Careers'; boardId = 'fujitsu' }
    @{ pattern = '^hitachi'; atsType = 'custom_enterprise'; boardUrl = 'https://www.hitachi.com/careers/'; boardId = 'hitachi' }
    @{ pattern = '^hudson.s bay'; atsType = 'workday'; boardUrl = 'https://hbc.wd3.myworkdayjobs.com/HBC_Careers'; boardId = 'hbc' }
    @{ pattern = '^mercedes benz'; atsType = 'workday'; boardUrl = 'https://mercedesbenz.wd3.myworkdayjobs.com/MercedesBenz_Careers'; boardId = 'mercedesbenz' }
    @{ pattern = '^motorola solutions'; atsType = 'custom_enterprise'; boardUrl = 'https://motorolasolutions.wd5.myworkdayjobs.com/Careers'; boardId = 'motorolasolutions' }
    @{ pattern = '^mercado libre'; atsType = 'custom_enterprise'; boardUrl = 'https://careers-meli.mercadolibre.com/en/search'; boardId = 'mercadolibre' }
    @{ pattern = '^konica minolta'; atsType = 'custom_enterprise'; boardUrl = 'https://www.konicaminolta.ca/en-ca/careers'; boardId = 'konicaminolta' }
    @{ pattern = '^lactalis'; atsType = 'custom_enterprise'; boardUrl = 'https://www.lactalis.ca/careers/'; boardId = 'lactalis' }
    @{ pattern = '^ledcor'; atsType = 'custom_enterprise'; boardUrl = 'https://www.ledcor.com/careers'; boardId = 'ledcor' }
    @{ pattern = '^canada goose'; atsType = 'workday'; boardUrl = 'https://canadagoose.wd3.myworkdayjobs.com/Careers'; boardId = 'canadagoose' }
    @{ pattern = '^gfl environmental'; atsType = 'custom_enterprise'; boardUrl = 'https://gflenv.com/careers/'; boardId = 'gfl' }
    @{ pattern = '^corpay'; atsType = 'custom_enterprise'; boardUrl = 'https://www.corpay.com/careers'; boardId = 'corpay' }
    @{ pattern = '^definity'; atsType = 'custom_enterprise'; boardUrl = 'https://www.definityfinancial.com/English/careers/'; boardId = 'definity' }
    @{ pattern = '^domtar'; atsType = 'custom_enterprise'; boardUrl = 'https://www.domtar.com/en/careers'; boardId = 'domtar' }
    @{ pattern = '^hydro qu'; atsType = 'custom_enterprise'; boardUrl = 'https://www.hydroquebec.com/careers/'; boardId = 'hydroquebec' }
    @{ pattern = 'interac'; atsType = 'custom_enterprise'; boardUrl = 'https://www.interac.ca/en/about/careers/'; boardId = 'interac' }
    @{ pattern = '^moneris'; atsType = 'custom_enterprise'; boardUrl = 'https://www.moneris.com/en/about-moneris/careers'; boardId = 'moneris' }
    @{ pattern = '^mnp$'; atsType = 'custom_enterprise'; boardUrl = 'https://www.mnp.ca/en/careers'; boardId = 'mnp' }
    @{ pattern = '^mnp digital'; atsType = 'custom_enterprise'; boardUrl = 'https://www.mnp.ca/en/careers'; boardId = 'mnp' }
    @{ pattern = '^calian'; atsType = 'custom_enterprise'; boardUrl = 'https://www.calian.com/careers/'; boardId = 'calian' }
    @{ pattern = '^camh'; atsType = 'custom_enterprise'; boardUrl = 'https://www.camh.ca/en/driving-change/careers'; boardId = 'camh' }
    @{ pattern = '^corus entertainment'; atsType = 'custom_enterprise'; boardUrl = 'https://www.corusent.com/careers/'; boardId = 'corus' }
    @{ pattern = '^freedom mobile'; atsType = 'custom_enterprise'; boardUrl = 'https://www.freedommobile.ca/en-CA/careers'; boardId = 'freedommobile' }
    @{ pattern = '^george brown'; atsType = 'custom_enterprise'; boardUrl = 'https://www.georgebrown.ca/about/careers'; boardId = 'georgebrown' }
    @{ pattern = '^georgian college'; atsType = 'custom_enterprise'; boardUrl = 'https://www.georgiancollege.ca/careers/'; boardId = 'georgian' }
    @{ pattern = '^greenshield'; atsType = 'custom_enterprise'; boardUrl = 'https://www.greenshield.ca/en-ca/careers'; boardId = 'greenshield' }
    @{ pattern = '^humber'; atsType = 'custom_enterprise'; boardUrl = 'https://humber.ca/careers/'; boardId = 'humber' }
    @{ pattern = '^ia financial'; atsType = 'custom_enterprise'; boardUrl = 'https://ia.ca/careers'; boardId = 'ia' }
    @{ pattern = '^igm financial'; atsType = 'custom_enterprise'; boardUrl = 'https://www.igmfinancial.com/en/careers'; boardId = 'igm' }
    @{ pattern = '^ig wealth'; atsType = 'custom_enterprise'; boardUrl = 'https://www.igmfinancial.com/en/careers'; boardId = 'igm' }
    @{ pattern = '^infrastructure ontario'; atsType = 'custom_enterprise'; boardUrl = 'https://www.infrastructureontario.ca/en/careers/'; boardId = 'infraontario' }
    @{ pattern = '^mlse'; atsType = 'custom_enterprise'; boardUrl = 'https://www.mlse.com/careers'; boardId = 'mlse' }
    @{ pattern = '^ontario government'; atsType = 'custom_enterprise'; boardUrl = 'https://www.gojobs.gov.on.ca/Search.aspx'; boardId = 'ontario-gov' }
    @{ pattern = '^ontario provincial'; atsType = 'custom_enterprise'; boardUrl = 'https://www.opp.ca/index.php?id=115&entryid=56b795ce8f94ac0d3487c2b5'; boardId = 'opp' }
    @{ pattern = '^ontario tech'; atsType = 'custom_enterprise'; boardUrl = 'https://ontariotechu.ca/careers/'; boardId = 'ontariotech' }
    @{ pattern = '^region of peel'; atsType = 'custom_enterprise'; boardUrl = 'https://peelregion.ca/careers/'; boardId = 'peelregion' }
    @{ pattern = '^sheridan college'; atsType = 'custom_enterprise'; boardUrl = 'https://www.sheridancollege.ca/about/careers'; boardId = 'sheridan' }
    @{ pattern = '^conestoga college'; atsType = 'custom_enterprise'; boardUrl = 'https://www.conestogac.on.ca/careers'; boardId = 'conestoga' }
    @{ pattern = '^ryerson'; atsType = 'custom_enterprise'; boardUrl = 'https://www.torontomu.ca/careers/'; boardId = 'torontomu' }
    @{ pattern = '^shared services canada'; atsType = 'custom_enterprise'; boardUrl = 'https://emploisfp-psjobs.cfp-psc.gc.ca/psrs-srfp/applicant/page1800'; boardId = 'gc-ssc' }
    @{ pattern = '^correctional service canada'; atsType = 'custom_enterprise'; boardUrl = 'https://emploisfp-psjobs.cfp-psc.gc.ca/psrs-srfp/applicant/page1800'; boardId = 'gc-csc' }
    @{ pattern = '^department of national'; atsType = 'custom_enterprise'; boardUrl = 'https://emploisfp-psjobs.cfp-psc.gc.ca/psrs-srfp/applicant/page1800'; boardId = 'gc-dnd' }
    @{ pattern = '^environment and climate'; atsType = 'custom_enterprise'; boardUrl = 'https://emploisfp-psjobs.cfp-psc.gc.ca/psrs-srfp/applicant/page1800'; boardId = 'gc-eccc' }
    @{ pattern = '^immigration refugees'; atsType = 'custom_enterprise'; boardUrl = 'https://emploisfp-psjobs.cfp-psc.gc.ca/psrs-srfp/applicant/page1800'; boardId = 'gc-ircc' }
    @{ pattern = '^innovation science'; atsType = 'custom_enterprise'; boardUrl = 'https://emploisfp-psjobs.cfp-psc.gc.ca/psrs-srfp/applicant/page1800'; boardId = 'gc-ised' }
    @{ pattern = '^export development canada'; atsType = 'custom_enterprise'; boardUrl = 'https://www.edc.ca/en/about-us/careers.html'; boardId = 'edc' }
    @{ pattern = '^treasury board'; atsType = 'custom_enterprise'; boardUrl = 'https://emploisfp-psjobs.cfp-psc.gc.ca/psrs-srfp/applicant/page1800'; boardId = 'gc-tbs' }
    @{ pattern = '^solicitor general'; atsType = 'custom_enterprise'; boardUrl = 'https://www.gojobs.gov.on.ca/Search.aspx'; boardId = 'ontario-gov' }
    @{ pattern = '^supply ontario'; atsType = 'custom_enterprise'; boardUrl = 'https://www.gojobs.gov.on.ca/Search.aspx'; boardId = 'ontario-gov' }
    @{ pattern = '^ehealth ontario'; atsType = 'custom_enterprise'; boardUrl = 'https://www.ehealthontario.on.ca/en/careers'; boardId = 'ehealthon' }
    @{ pattern = '^ul solutions'; atsType = 'custom_enterprise'; boardUrl = 'https://www.ul.com/about/careers'; boardId = 'ul' }
    @{ pattern = 'united nations'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.un.org/'; boardId = 'un' }
    @{ pattern = '^ci financial'; atsType = 'custom_enterprise'; boardUrl = 'https://www.cifinancial.com/ci-financial/careers'; boardId = 'cifinancial' }
    @{ pattern = '^century 21'; atsType = 'custom_enterprise'; boardUrl = 'https://www.century21.ca/careers'; boardId = 'century21' }
    @{ pattern = '^wilsonhcg'; atsType = 'custom_enterprise'; boardUrl = 'https://www.wilsonhcg.com/careers'; boardId = 'wilsonhcg' }
    @{ pattern = '^sita$'; atsType = 'custom_enterprise'; boardUrl = 'https://www.sita.aero/careers/'; boardId = 'sita' }
    @{ pattern = 'york region'; atsType = 'custom_enterprise'; boardUrl = 'https://www.york.ca/york-region/careers'; boardId = 'yorkregion' }
    @{ pattern = 'workplace safety'; atsType = 'custom_enterprise'; boardUrl = 'https://www.wsib.ca/en/careers'; boardId = 'wsib' }
    @{ pattern = 'hoopp'; atsType = 'custom_enterprise'; boardUrl = 'https://hoopp.com/about-hoopp/careers'; boardId = 'hoopp' }
    @{ pattern = 'optrust'; atsType = 'custom_enterprise'; boardUrl = 'https://www.optrust.com/careers/'; boardId = 'optrust' }
    @{ pattern = 'caat pension'; atsType = 'custom_enterprise'; boardUrl = 'https://www.caatpension.ca/about/careers'; boardId = 'caat' }
    @{ pattern = 'north york general'; atsType = 'custom_enterprise'; boardUrl = 'https://www.nygh.on.ca/careers'; boardId = 'nygh' }
    @{ pattern = 'the hospital for sick'; atsType = 'custom_enterprise'; boardUrl = 'https://www.sickkids.ca/en/careers/'; boardId = 'sickkids' }
    @{ pattern = 'unity health toronto'; atsType = 'custom_enterprise'; boardUrl = 'https://www.unityhealth.to/careers/'; boardId = 'unityhealth' }
    @{ pattern = 'mackenzie health'; atsType = 'custom_enterprise'; boardUrl = 'https://www.mackenziehealth.ca/en/careers.aspx'; boardId = 'mackenziehealth' }
    @{ pattern = '^csa group'; atsType = 'custom_enterprise'; boardUrl = 'https://www.csagroup.org/about/careers/'; boardId = 'csagroup' }
    @{ pattern = '^canadian nuclear'; atsType = 'custom_enterprise'; boardUrl = 'https://www.cnl.ca/careers/'; boardId = 'cnl' }
    @{ pattern = '^deciem'; atsType = 'custom_enterprise'; boardUrl = 'https://deciem.com/en-ca/careers'; boardId = 'deciem' }
    @{ pattern = 'intuit$'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.intuit.com/search-jobs'; boardId = 'intuit' }
    @{ pattern = '^sienna senior'; atsType = 'custom_enterprise'; boardUrl = 'https://www.siennaliving.ca/careers'; boardId = 'sienna' }
    @{ pattern = 'mccarthy'; atsType = 'custom_enterprise'; boardUrl = 'https://www.mccarthy.ca/en/careers'; boardId = 'mccarthy' }
    @{ pattern = 'stikeman elliott'; atsType = 'custom_enterprise'; boardUrl = 'https://www.stikeman.com/en-ca/careers'; boardId = 'stikeman' }
    @{ pattern = 'miller thomson'; atsType = 'custom_enterprise'; boardUrl = 'https://www.millerthomson.com/en/careers/'; boardId = 'millerthomson' }
    @{ pattern = '^evercommerce'; atsType = 'custom_enterprise'; boardUrl = 'https://www.evercommerce.com/company/careers/'; boardId = 'evercommerce' }
    @{ pattern = '^dufferin'; atsType = 'custom_enterprise'; boardUrl = 'https://www3.dpcdsb.org/careers'; boardId = 'dpcdsb' }
    @{ pattern = 'peel regional police'; atsType = 'custom_enterprise'; boardUrl = 'https://www.peelpolice.ca/en/careers/careers.aspx'; boardId = 'peelpolice' }
    @{ pattern = 'arctic wolf'; atsType = 'custom_enterprise'; boardUrl = 'https://arcticwolf.wd1.myworkdayjobs.com/External'; boardId = 'arcticwolf' }
    @{ pattern = '^cogeco'; atsType = 'custom_enterprise'; boardUrl = 'https://www.cogeco.ca/en/careers'; boardId = 'cogeco' }
    @{ pattern = 'accruent'; atsType = 'custom_enterprise'; boardUrl = 'https://www.accruent.com/company/careers'; boardId = 'accruent' }
    @{ pattern = 'altus group'; atsType = 'custom_enterprise'; boardUrl = 'https://www.altusgroup.com/careers/'; boardId = 'altus' }
    @{ pattern = 'vena solutions'; atsType = 'custom_enterprise'; boardUrl = 'https://www.venasolutions.com/about-us/careers'; boardId = 'vena' }
    @{ pattern = 'bd$'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.bd.com/search-jobs'; boardId = 'bd' }
    @{ pattern = 'aprio'; atsType = 'custom_enterprise'; boardUrl = 'https://www.aprio.com/careers/'; boardId = 'aprio' }
    @{ pattern = 'born group'; atsType = 'custom_enterprise'; boardUrl = 'https://www.borngroup.com/careers/'; boardId = 'borngroup' }
    @{ pattern = 'rakuten kobo'; atsType = 'custom_enterprise'; boardUrl = 'https://www.kobo.com/ca/en/p/careers'; boardId = 'kobo' }
    @{ pattern = 'recipe unlimited'; atsType = 'custom_enterprise'; boardUrl = 'https://www.recipeunlimited.com/careers'; boardId = 'recipe' }
    @{ pattern = 'toronto community housing'; atsType = 'custom_enterprise'; boardUrl = 'https://www.torontohousing.ca/careers'; boardId = 'tchc' }
    @{ pattern = 'toronto stock exchange'; atsType = 'custom_enterprise'; boardUrl = 'https://www.tmx.com/careers'; boardId = 'tmx' }
    @{ pattern = 'mark anthony'; atsType = 'custom_enterprise'; boardUrl = 'https://www.markanthony.com/careers'; boardId = 'markanthony' }
    @{ pattern = '^visier'; atsType = 'custom_enterprise'; boardUrl = 'https://www.visier.com/careers/'; boardId = 'visier' }
    @{ pattern = '^xello$'; atsType = 'custom_enterprise'; boardUrl = 'https://xello.world/en/careers/'; boardId = 'xello' }
)

Write-Host "Loading no_match configs..."
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT bc.id, bc.normalized_company_name FROM board_configs bc WHERE bc.discovery_status = 'no_match_supported_ats' ORDER BY bc.normalized_company_name"
$reader = $cmd.ExecuteReader()
$configs = @()
while ($reader.Read()) { $configs += @{ id = [string]$reader['id']; normalizedName = [string]$reader['normalized_company_name'] } }
$reader.Close()
Write-Host "Found $($configs.Count) no-match configs (batch 3)"

$resolved = 0
$updateCmd = $conn.CreateCommand()

foreach ($config in $configs) {
    $name = $config.normalizedName
    foreach ($mapping in $knownMappings) {
        if ($name -match $mapping.pattern) {
            Write-Host "  MAPPED: $name => $($mapping.atsType) ($($mapping.boardId))"
            $now = (Get-Date).ToString('o')
            $next = (Get-Date).AddDays(90).ToString('o')
            $atsType = $mapping.atsType
            $boardUrl = $mapping.boardUrl
            $boardId = $mapping.boardId
            $supportedInt = if ($atsType -in @('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday', 'jobvite')) { 1 } else { 0 }
            $supportedJson = if ($supportedInt -eq 1) { "true" } else { "false" }
            $safeEvidence = "Known enterprise mapping for $name"
            $updateCmd.CommandText = @"
UPDATE board_configs SET
  ats_type = '$atsType', board_id = '$boardId', resolved_board_url = '$boardUrl',
  active = 1, supported_import = $supportedInt, discovery_status = 'discovered',
  discovery_method = 'known_enterprise_map', confidence_score = 95, confidence_band = 'high',
  evidence_summary = '$safeEvidence', review_status = 'auto', failure_reason = '',
  last_checked_at = '$now', last_resolution_attempt_at = '$now', next_resolution_attempt_at = '$next',
  data_json = json_set(data_json,
    '$.atsType', '$atsType', '$.boardId', '$boardId', '$.resolvedBoardUrl', '$boardUrl',
    '$.active', json('true'), '$.supportedImport', json('$supportedJson'),
    '$.discoveryStatus', 'discovered', '$.discoveryMethod', 'known_enterprise_map',
    '$.confidenceScore', 95, '$.confidenceBand', 'high',
    '$.evidenceSummary', '$safeEvidence', '$.reviewStatus', 'auto', '$.failureReason', '',
    '$.lastCheckedAt', '$now', '$.lastResolutionAttemptAt', '$now', '$.nextResolutionAttemptAt', '$next')
WHERE id = '$($config.id)'
"@
            $updateCmd.ExecuteNonQuery() | Out-Null
            $resolved++
            break
        }
    }
}

$conn.Close()
Write-Host "`n=== BATCH 3 COMPLETE === Matched: $resolved / $($configs.Count)"

$conn2 = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn2.Open()
$cmd2 = $conn2.CreateCommand()
$cmd2.CommandText = "SELECT COUNT(*) as total, SUM(CASE WHEN discovery_status IN ('discovered', 'verified', 'mapped') THEN 1 ELSE 0 END) as resolved FROM board_configs"
$r = $cmd2.ExecuteReader(); $r.Read()
Write-Host "=== OVERALL: $($r['resolved']) / $($r['total']) ($([math]::Round([int]$r['resolved'] / [math]::Max(1, [int]$r['total']) * 100, 1))%)"
$r.Close(); $conn2.Close()
