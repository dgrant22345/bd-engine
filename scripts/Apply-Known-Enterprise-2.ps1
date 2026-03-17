param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"

# Second batch of known enterprise career page mappings
$knownMappings = @(
    # Tech companies
    @{ pattern = '^akamai'; atsType = 'custom_enterprise'; boardUrl = 'https://akamaicareers.inflightcloud.com/'; boardId = 'akamai' }
    @{ pattern = '^at and t$'; atsType = 'workday'; boardUrl = 'https://att.wd5.myworkdayjobs.com/att_careers'; boardId = 'att' }
    @{ pattern = 'charter communications'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.spectrum.com/'; boardId = 'spectrum' }
    @{ pattern = '^ciena'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.ciena.com/'; boardId = 'ciena' }
    @{ pattern = '^clarivate'; atsType = 'workday'; boardUrl = 'https://clarivate.wd1.myworkdayjobs.com/Clarivate_Careers'; boardId = 'clarivate' }
    @{ pattern = '^cohesity'; atsType = 'custom_enterprise'; boardUrl = 'https://www.cohesity.com/company/careers/open-positions/'; boardId = 'cohesity' }
    @{ pattern = '^epam'; atsType = 'custom_enterprise'; boardUrl = 'https://www.epam.com/careers/job-listings'; boardId = 'epam' }
    @{ pattern = '^genesys'; atsType = 'custom_enterprise'; boardUrl = 'https://genesys.wd1.myworkdayjobs.com/Genesys'; boardId = 'genesys' }
    @{ pattern = '^netapp'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.netapp.com/search-jobs'; boardId = 'netapp' }
    @{ pattern = '^proofpoint'; atsType = 'custom_enterprise'; boardUrl = 'https://proofpoint.wd5.myworkdayjobs.com/ProofpointCareers'; boardId = 'proofpoint' }
    @{ pattern = '^ringcentral'; atsType = 'custom_enterprise'; boardUrl = 'https://ringcentral.wd1.myworkdayjobs.com/RingCentral_Careers'; boardId = 'ringcentral' }
    @{ pattern = '^splunk'; atsType = 'custom_enterprise'; boardUrl = 'https://www.splunk.com/en_us/careers/search.html'; boardId = 'splunk' }
    @{ pattern = '^tenable'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.tenable.com/search/jobs'; boardId = 'tenable' }
    @{ pattern = '^verizon'; atsType = 'workday'; boardUrl = 'https://mycareer.verizon.com/jobs/SearchJobs'; boardId = 'verizon' }
    @{ pattern = '^workday$'; atsType = 'workday'; boardUrl = 'https://workday.wd5.myworkdayjobs.com/Workday'; boardId = 'workday' }
    @{ pattern = '^zebra tech'; atsType = 'workday'; boardUrl = 'https://zebra.wd1.myworkdayjobs.com/Zebra_Careers'; boardId = 'zebra' }
    @{ pattern = '^zynga'; atsType = 'custom_enterprise'; boardUrl = 'https://www.zynga.com/careers/positions'; boardId = 'zynga' }
    @{ pattern = 'cerebras'; atsType = 'custom_enterprise'; boardUrl = 'https://cerebras.ai/careers'; boardId = 'cerebras' }
    @{ pattern = '^checkmarx'; atsType = 'custom_enterprise'; boardUrl = 'https://www.checkmarx.com/company/careers/'; boardId = 'checkmarx' }
    @{ pattern = 'powerschool'; atsType = 'custom_enterprise'; boardUrl = 'https://www.powerschool.com/company/careers/'; boardId = 'powerschool' }
    @{ pattern = '^sps commerce'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.spscommerce.com/jobs/search'; boardId = 'spscommerce' }
    @{ pattern = '^tipalti'; atsType = 'greenhouse'; boardUrl = 'https://boards-api.greenhouse.io/v1/boards/tipalti/jobs'; boardId = 'tipalti' }
    @{ pattern = '^planful'; atsType = 'greenhouse'; boardUrl = 'https://boards-api.greenhouse.io/v1/boards/planful/jobs'; boardId = 'planful' }
    @{ pattern = '^workiva'; atsType = 'custom_enterprise'; boardUrl = 'https://www.workiva.com/careers'; boardId = 'workiva' }
    @{ pattern = '^soti$'; atsType = 'custom_enterprise'; boardUrl = 'https://www.soti.net/company/careers/'; boardId = 'soti' }

    # Enterprise/IT services
    @{ pattern = '^adecco'; atsType = 'custom_enterprise'; boardUrl = 'https://www.adecco.ca/en-ca/find-jobs/'; boardId = 'adecco' }
    @{ pattern = '^akkodis'; atsType = 'custom_enterprise'; boardUrl = 'https://www.akkodis.com/en/careers'; boardId = 'akkodis' }
    @{ pattern = '^alstom'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.alstom.com/search'; boardId = 'alstom' }
    @{ pattern = '^amdocs'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.amdocs.com/search-results'; boardId = 'amdocs' }
    @{ pattern = '^atos$'; atsType = 'custom_enterprise'; boardUrl = 'https://atos.net/en/careers'; boardId = 'atos' }
    @{ pattern = '^avanade'; atsType = 'workday'; boardUrl = 'https://avanade.wd1.myworkdayjobs.com/AvanadeCareers'; boardId = 'avanade' }
    @{ pattern = '^broadridge'; atsType = 'workday'; boardUrl = 'https://broadridge.wd5.myworkdayjobs.com/Broadridge_Careers'; boardId = 'broadridge' }
    @{ pattern = '^dxc tech'; atsType = 'workday'; boardUrl = 'https://dxctechnology.wd1.myworkdayjobs.com/DXCJobSite'; boardId = 'dxctechnology' }
    @{ pattern = '^finastra'; atsType = 'custom_enterprise'; boardUrl = 'https://www.finastra.com/careers'; boardId = 'finastra' }
    @{ pattern = '^fiserv'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.fiserv.com/search-jobs'; boardId = 'fiserv' }
    @{ pattern = '^fis$'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.fisglobal.com/us/en/search-results'; boardId = 'fis' }
    @{ pattern = '^guidewire'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.guidewire.com/search'; boardId = 'guidewire' }
    @{ pattern = '^hcl'; atsType = 'custom_enterprise'; boardUrl = 'https://www.hcltech.com/careers/'; boardId = 'hcltech' }
    @{ pattern = '^hexaware'; atsType = 'custom_enterprise'; boardUrl = 'https://hexaware.com/careers/'; boardId = 'hexaware' }
    @{ pattern = '^ingram micro'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.ingrammicro.com/search-jobs'; boardId = 'ingrammicro' }
    @{ pattern = '^infor$'; atsType = 'custom_enterprise'; boardUrl = 'https://www.infor.com/about/careers'; boardId = 'infor' }
    @{ pattern = '^iqvia'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.iqvia.com/search-results'; boardId = 'iqvia' }
    @{ pattern = '^kyndryl'; atsType = 'workday'; boardUrl = 'https://kyndryl.wd5.myworkdayjobs.com/Kyndryl_Careers'; boardId = 'kyndryl' }
    @{ pattern = '^ltimindtree'; atsType = 'custom_enterprise'; boardUrl = 'https://www.ltimindtree.com/careers/'; boardId = 'ltimindtree' }
    @{ pattern = '^mphasis'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.mphasis.com/search-results'; boardId = 'mphasis' }
    @{ pattern = '^ntt data'; atsType = 'workday'; boardUrl = 'https://nttdata.wd1.myworkdayjobs.com/NTTDATACareers'; boardId = 'nttdata' }
    @{ pattern = '^persistent systems'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.persistent.com/search-results'; boardId = 'persistent' }
    @{ pattern = '^publicis sapient'; atsType = 'custom_enterprise'; boardUrl = 'https://www.publicissapient.com/careers'; boardId = 'publicissapient' }
    @{ pattern = '^sopra steria'; atsType = 'custom_enterprise'; boardUrl = 'https://www.soprasteria.com/careers'; boardId = 'soprasteria' }
    @{ pattern = '^tech mahindra'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.techmahindra.com/'; boardId = 'techmahindra' }
    @{ pattern = '^teksystems'; atsType = 'custom_enterprise'; boardUrl = 'https://www.teksystems.com/en/careers'; boardId = 'teksystems' }
    @{ pattern = '^teleperformance'; atsType = 'custom_enterprise'; boardUrl = 'https://www.teleperformance.com/en-us/careers/'; boardId = 'teleperformance' }
    @{ pattern = '^virtusa'; atsType = 'custom_enterprise'; boardUrl = 'https://www.virtusa.com/careers'; boardId = 'virtusa' }
    @{ pattern = '^ukg$'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.ukg.com/careers/SearchJobs'; boardId = 'ukg' }
    @{ pattern = '^wsp'; atsType = 'workday'; boardUrl = 'https://wsp.wd3.myworkdayjobs.com/WSP_Careers'; boardId = 'wsp' }

    # Financial / Insurance
    @{ pattern = '^aviva canada'; atsType = 'workday'; boardUrl = 'https://aviva.wd3.myworkdayjobs.com/Aviva_Canada'; boardId = 'aviva' }
    @{ pattern = '^bnp paribas'; atsType = 'custom_enterprise'; boardUrl = 'https://group.bnpparibas/en/careers'; boardId = 'bnpparibas' }
    @{ pattern = '^bny$'; atsType = 'custom_enterprise'; boardUrl = 'https://bnymellon.eightfold.ai/careers'; boardId = 'bny' }
    @{ pattern = '^boston scientific'; atsType = 'workday'; boardUrl = 'https://bostonscientific.wd1.myworkdayjobs.com/BSCCareers'; boardId = 'bostonscientific' }
    @{ pattern = '^chubb'; atsType = 'workday'; boardUrl = 'https://chubb.wd5.myworkdayjobs.com/ChubbCareers'; boardId = 'chubb' }
    @{ pattern = '^mufg'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.mufgamericas.com/search-jobs'; boardId = 'mufg' }
    @{ pattern = '^paychex'; atsType = 'workday'; boardUrl = 'https://paychex.wd5.myworkdayjobs.com/ExternalCareerSite'; boardId = 'paychex' }
    @{ pattern = '^primerica'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.primerica.com/'; boardId = 'primerica' }
    @{ pattern = '^state farm'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.statefarm.com/main/jobs'; boardId = 'statefarm' }
    @{ pattern = '^travelers'; atsType = 'workday'; boardUrl = 'https://travelers.wd5.myworkdayjobs.com/External'; boardId = 'travelers' }
    @{ pattern = '^u s bank'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.usbank.com/global/en/search-results'; boardId = 'usbank' }
    @{ pattern = '^wawanesa'; atsType = 'custom_enterprise'; boardUrl = 'https://www.wawanesa.com/canada/about-us/careers.html'; boardId = 'wawanesa' }
    @{ pattern = '^zurich'; atsType = 'custom_enterprise'; boardUrl = 'https://www.zurich.com/en/careers'; boardId = 'zurich' }

    # Industrial / Manufacturing
    @{ pattern = '^alithya'; atsType = 'custom_enterprise'; boardUrl = 'https://www.alithya.com/en/careers'; boardId = 'alithya' }
    @{ pattern = '^arcadis'; atsType = 'workday'; boardUrl = 'https://arcadis.wd3.myworkdayjobs.com/Arcadis'; boardId = 'arcadis' }
    @{ pattern = '^cae$'; atsType = 'workday'; boardUrl = 'https://cae.wd3.myworkdayjobs.com/careers'; boardId = 'cae' }
    @{ pattern = '^canon canada'; atsType = 'custom_enterprise'; boardUrl = 'https://www.canon.ca/en/About-Canon/Careers'; boardId = 'canoncanada' }
    @{ pattern = '^ceva logistics'; atsType = 'custom_enterprise'; boardUrl = 'https://www.cevalogistics.com/en/careers'; boardId = 'ceva' }
    @{ pattern = '^chamberlain'; atsType = 'custom_enterprise'; boardUrl = 'https://chamberlain.wd1.myworkdayjobs.com/Chamberlain_Careers'; boardId = 'chamberlain' }
    @{ pattern = 'eaton'; atsType = 'custom_enterprise'; boardUrl = 'https://eaton.eightfold.ai/careers'; boardId = 'eaton' }
    @{ pattern = 'johnson controls'; atsType = 'workday'; boardUrl = 'https://johnsoncontrols.wd5.myworkdayjobs.com/JCI_Careers'; boardId = 'johnsoncontrols' }
    @{ pattern = '^l3harris'; atsType = 'workday'; boardUrl = 'https://l3harris.wd1.myworkdayjobs.com/L3Harris_Careers'; boardId = 'l3harris' }
    @{ pattern = '^philip morris'; atsType = 'custom_enterprise'; boardUrl = 'https://www.pmi.com/careers/search-results'; boardId = 'pmi' }
    @{ pattern = 'pratt and whitney'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.rtx.com/global/en/search-results'; boardId = 'rtx' }
    @{ pattern = '^ricoh'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.ricoh.com/search-results'; boardId = 'ricoh' }
    @{ pattern = '^rio tinto'; atsType = 'custom_enterprise'; boardUrl = 'https://www.riotinto.com/careers'; boardId = 'riotinto' }
    @{ pattern = '^saputo'; atsType = 'custom_enterprise'; boardUrl = 'https://www.saputo.com/en/careers'; boardId = 'saputo' }
    @{ pattern = '^stanley black'; atsType = 'workday'; boardUrl = 'https://stanleyblackanddecker.wd1.myworkdayjobs.com/SBD_Careers'; boardId = 'sbd' }
    @{ pattern = '^staples'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.staples.com/en-us/search-jobs'; boardId = 'staples' }
    @{ pattern = '^teck resources'; atsType = 'custom_enterprise'; boardUrl = 'https://www.teck.com/careers'; boardId = 'teck' }
    @{ pattern = '^teva pharma'; atsType = 'workday'; boardUrl = 'https://tevapharm.wd3.myworkdayjobs.com/TevaCareers'; boardId = 'tevapharm' }
    @{ pattern = '^the tjx'; atsType = 'custom_enterprise'; boardUrl = 'https://tjx.wd1.myworkdayjobs.com/TJXNA'; boardId = 'tjx' }
    @{ pattern = '^wesco$'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.wesco.com/'; boardId = 'wesco' }

    # Canadian orgs
    @{ pattern = '^alberta health'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.albertahealthservices.ca/'; boardId = 'ahs' }
    @{ pattern = '^atb financial'; atsType = 'custom_enterprise'; boardUrl = 'https://www.atb.com/careers/'; boardId = 'atb' }
    @{ pattern = '^bank of canada'; atsType = 'custom_enterprise'; boardUrl = 'https://www.bankofcanada.ca/careers/'; boardId = 'boc' }
    @{ pattern = '^bayshore'; atsType = 'custom_enterprise'; boardUrl = 'https://www.bayshore.ca/careers/'; boardId = 'bayshore' }
    @{ pattern = '^bdc$'; atsType = 'custom_enterprise'; boardUrl = 'https://www.bdc.ca/en/about/careers'; boardId = 'bdc' }
    @{ pattern = '^cbc'; atsType = 'custom_enterprise'; boardUrl = 'https://cbc.radio-canada.ca/en/careers/job-opportunities'; boardId = 'cbc' }
    @{ pattern = '^cdw'; atsType = 'workday'; boardUrl = 'https://cdw.wd1.myworkdayjobs.com/External'; boardId = 'cdw' }
    @{ pattern = '^cineplex'; atsType = 'custom_enterprise'; boardUrl = 'https://www.cineplex.com/Corporate/Careers'; boardId = 'cineplex' }
    @{ pattern = '^co operators'; atsType = 'custom_enterprise'; boardUrl = 'https://www.cooperators.ca/about-us/careers/'; boardId = 'cooperators' }
    @{ pattern = '^dynacare'; atsType = 'custom_enterprise'; boardUrl = 'https://www.dynacare.ca/en/careers.aspx'; boardId = 'dynacare' }
    @{ pattern = '^gardaworld'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.gardaworld.com/search-results'; boardId = 'gardaworld' }
    @{ pattern = '^government of alberta'; atsType = 'custom_enterprise'; boardUrl = 'https://www.alberta.ca/jobs'; boardId = 'alberta-gov' }
    @{ pattern = '^government of new brunswick'; atsType = 'custom_enterprise'; boardUrl = 'https://www2.gnb.ca/content/gnb/en/departments/human_resources/career_opportunities.html'; boardId = 'nb-gov' }
    @{ pattern = '^imax'; atsType = 'custom_enterprise'; boardUrl = 'https://www.imax.com/en/content/careers'; boardId = 'imax' }
    @{ pattern = '^niagara region'; atsType = 'custom_enterprise'; boardUrl = 'https://www.niagararegion.ca/government/hr/careers/default.aspx'; boardId = 'niagara' }
    @{ pattern = '^olg$'; atsType = 'custom_enterprise'; boardUrl = 'https://www.olg.ca/en/about-olg/careers.html'; boardId = 'olg' }
    @{ pattern = '^ontario teachers'; atsType = 'custom_enterprise'; boardUrl = 'https://www.otpp.com/en-ca/careers/'; boardId = 'otpp' }
    @{ pattern = '^purolator'; atsType = 'workday'; boardUrl = 'https://purolator.wd3.myworkdayjobs.com/Purolator_Careers'; boardId = 'purolator' }
    @{ pattern = '^questrade'; atsType = 'custom_enterprise'; boardUrl = 'https://www.questrade.com/about-us/careers'; boardId = 'questrade' }
    @{ pattern = '^scotiabank'; atsType = 'workday'; boardUrl = 'https://scotiabank.wd3.myworkdayjobs.com/External'; boardId = 'scotiabank' }
    @{ pattern = '^tangerine'; atsType = 'custom_enterprise'; boardUrl = 'https://www.tangerine.ca/en/about-us/careers'; boardId = 'tangerine' }
    @{ pattern = '^toronto district school'; atsType = 'custom_enterprise'; boardUrl = 'https://www.tdsb.on.ca/About-Us/Employment'; boardId = 'tdsb' }
    @{ pattern = '^toronto hydro'; atsType = 'custom_enterprise'; boardUrl = 'https://www.torontohydro.com/careers'; boardId = 'torontohydro' }
    @{ pattern = '^toronto metropolitan'; atsType = 'custom_enterprise'; boardUrl = 'https://www.torontomu.ca/careers/'; boardId = 'torontomu' }
    @{ pattern = '^translink'; atsType = 'custom_enterprise'; boardUrl = 'https://www.translink.ca/about-us/careers'; boardId = 'translink' }
    @{ pattern = '^vancity'; atsType = 'custom_enterprise'; boardUrl = 'https://www.vancity.com/about/careers/'; boardId = 'vancity' }
    @{ pattern = '^tim hortons'; atsType = 'custom_enterprise'; boardUrl = 'https://www.timhortons.ca/careers'; boardId = 'timhortons' }
    @{ pattern = '^pizza pizza'; atsType = 'custom_enterprise'; boardUrl = 'https://www.pizzapizza.ca/careers'; boardId = 'pizzapizza' }
    @{ pattern = '^eq bank'; atsType = 'custom_enterprise'; boardUrl = 'https://www.eqbank.ca/about-us/careers'; boardId = 'eqbank' }
    @{ pattern = '^equinix'; atsType = 'workday'; boardUrl = 'https://equinix.wd1.myworkdayjobs.com/External'; boardId = 'equinix' }
    @{ pattern = '^edward jones'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.edwardjones.com/search-jobs'; boardId = 'edwardjones' }
    @{ pattern = '^centene'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.centene.com/search-jobs'; boardId = 'centene' }
    @{ pattern = '^ford motor'; atsType = 'workday'; boardUrl = 'https://efds.fa.em5.oraclecloud.com/hcmUI/CandidateExperience'; boardId = 'ford' }
    @{ pattern = '^gartner'; atsType = 'workday'; boardUrl = 'https://gartner.wd5.myworkdayjobs.com/EXT'; boardId = 'gartner' }
    @{ pattern = 'infineon'; atsType = 'custom_enterprise'; boardUrl = 'https://www.infineon.com/cms/en/careers/'; boardId = 'infineon' }
    @{ pattern = '^insperity'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.insperity.com/search-results'; boardId = 'insperity' }
    @{ pattern = '^korn ferry'; atsType = 'custom_enterprise'; boardUrl = 'https://www.kornferry.com/about/careers'; boardId = 'kornferry' }
    @{ pattern = '^michael page'; atsType = 'custom_enterprise'; boardUrl = 'https://www.michaelpage.ca/jobs'; boardId = 'michaelpage' }
    @{ pattern = '^hays$'; atsType = 'custom_enterprise'; boardUrl = 'https://www.hays.ca/en/jobs'; boardId = 'hays' }
    @{ pattern = '^globant'; atsType = 'custom_enterprise'; boardUrl = 'https://www.globant.com/careers'; boardId = 'globant' }
    @{ pattern = '^ritchie bros'; atsType = 'workday'; boardUrl = 'https://ritchiebros.wd3.myworkdayjobs.com/Ritchie_Bros_Careers'; boardId = 'ritchiebros' }
    @{ pattern = '^mcgraw hill'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.mheducation.com/search-results'; boardId = 'mcgrawhill' }
    @{ pattern = '^mckesson'; atsType = 'custom_enterprise'; boardUrl = 'https://mckesson.wd3.myworkdayjobs.com/Careers'; boardId = 'mckesson' }
    @{ pattern = '^ncr corp'; atsType = 'custom_enterprise'; boardUrl = 'https://www.ncr.com/company/careers'; boardId = 'ncr' }
    @{ pattern = '^rsm'; atsType = 'custom_enterprise'; boardUrl = 'https://rsmus.wd1.myworkdayjobs.com/RSM_Careers'; boardId = 'rsm' }
    @{ pattern = '^shi international'; atsType = 'custom_enterprise'; boardUrl = 'https://www.shi.com/careers'; boardId = 'shi' }
    @{ pattern = 'mondelez'; atsType = 'workday'; boardUrl = 'https://mondelez.wd3.myworkdayjobs.com/MDLZ_Careers'; boardId = 'mondelez' }
    @{ pattern = 'priceline'; atsType = 'custom_enterprise'; boardUrl = 'https://www.priceline.com/careers/'; boardId = 'priceline' }
    @{ pattern = '^sap concur'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.sap.com/search/'; boardId = 'sap' }
    @{ pattern = 'square$'; atsType = 'custom_enterprise'; boardUrl = 'https://block.xyz/careers'; boardId = 'block' }
    @{ pattern = '^amgen$'; atsType = 'workday'; boardUrl = 'https://amgen.wd1.myworkdayjobs.com/Careers'; boardId = 'amgen' }
    @{ pattern = 'apotex'; atsType = 'custom_enterprise'; boardUrl = 'https://www.apotex.com/ca/en/careers'; boardId = 'apotex' }
    @{ pattern = '^avalara'; atsType = 'custom_enterprise'; boardUrl = 'https://www.avalara.com/us/en/about/careers.html'; boardId = 'avalara' }
    @{ pattern = '^seequent'; atsType = 'custom_enterprise'; boardUrl = 'https://www.seequent.com/company/careers/'; boardId = 'seequent' }
    @{ pattern = '^suncor'; atsType = 'custom_enterprise'; boardUrl = 'https://www.suncor.com/careers'; boardId = 'suncor' }
    @{ pattern = 'stemcell tech'; atsType = 'custom_enterprise'; boardUrl = 'https://www.stemcell.com/about-us/careers'; boardId = 'stemcell' }
)

Write-Host "Loading no_match configs from SQLite..."
$conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn.Open()
$cmd = $conn.CreateCommand()

$cmd.CommandText = @"
SELECT bc.id, bc.normalized_company_name
FROM board_configs bc
WHERE bc.discovery_status = 'no_match_supported_ats'
ORDER BY bc.normalized_company_name
"@
$reader = $cmd.ExecuteReader()
$configs = @()
while ($reader.Read()) {
    $configs += @{
        id = [string]$reader['id']
        normalizedName = [string]$reader['normalized_company_name']
    }
}
$reader.Close()

Write-Host "Found $($configs.Count) no-match configs to check against known mappings (batch 2)"

$resolved = 0
$updateCmd = $conn.CreateCommand()

foreach ($config in $configs) {
    $name = $config.normalizedName
    $matched = $null

    foreach ($mapping in $knownMappings) {
        if ($name -match $mapping.pattern) {
            $matched = $mapping
            break
        }
    }

    if ($matched) {
        if ($DryRun) {
            Write-Host "  WOULD MAP: $name => $($matched.atsType) ($($matched.boardId))"
            $resolved++
            continue
        }

        Write-Host "  MAPPED: $name => $($matched.atsType) ($($matched.boardId))"

        try {
            $now = (Get-Date).ToString('o')
            $next = (Get-Date).AddDays(90).ToString('o')
            $atsType = $matched.atsType
            $boardUrl = $matched.boardUrl
            $boardId = $matched.boardId
            $supportedInt = if ($atsType -in @('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday', 'jobvite')) { 1 } else { 0 }
            $supportedJson = if ($supportedInt -eq 1) { "true" } else { "false" }
            $safeEvidence = "Known enterprise mapping for $name"
            $updateCmd.CommandText = @"
UPDATE board_configs SET
  ats_type = '$atsType',
  board_id = '$boardId',
  resolved_board_url = '$boardUrl',
  active = 1,
  supported_import = $supportedInt,
  discovery_status = 'discovered',
  discovery_method = 'known_enterprise_map',
  confidence_score = 95,
  confidence_band = 'high',
  evidence_summary = '$safeEvidence',
  review_status = 'auto',
  failure_reason = '',
  last_checked_at = '$now',
  last_resolution_attempt_at = '$now',
  next_resolution_attempt_at = '$next',
  data_json = json_set(data_json,
    '$.atsType', '$atsType',
    '$.boardId', '$boardId',
    '$.resolvedBoardUrl', '$boardUrl',
    '$.active', json('true'),
    '$.supportedImport', json('$supportedJson'),
    '$.discoveryStatus', 'discovered',
    '$.discoveryMethod', 'known_enterprise_map',
    '$.confidenceScore', 95,
    '$.confidenceBand', 'high',
    '$.evidenceSummary', '$safeEvidence',
    '$.reviewStatus', 'auto',
    '$.failureReason', '',
    '$.lastCheckedAt', '$now',
    '$.lastResolutionAttemptAt', '$now',
    '$.nextResolutionAttemptAt', '$next'
  )
WHERE id = '$($config.id)'
"@
            $updateCmd.ExecuteNonQuery() | Out-Null
            $resolved++
        } catch {
            Write-Host "    DB update error: $_"
        }
    }
}

$conn.Close()

Write-Host ""
Write-Host "=== KNOWN ENTERPRISE MAPPING (BATCH 2) COMPLETE ==="
Write-Host "Matched: $resolved / $($configs.Count)"

# Final stats
$conn2 = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$root\data\bd-engine.db")
$conn2.Open()
$cmd2 = $conn2.CreateCommand()
$cmd2.CommandText = @"
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN discovery_status IN ('discovered', 'verified', 'mapped') THEN 1 ELSE 0 END) as resolved
FROM board_configs
"@
$r = $cmd2.ExecuteReader()
$r.Read()
$totalConfigs = [int]$r['total']
$totalResolved = [int]$r['resolved']
$r.Close()
$conn2.Close()
$finalPct = [math]::Round($totalResolved / [math]::Max(1, $totalConfigs) * 100, 1)
Write-Host ""
Write-Host "=== OVERALL BOARD RESOLUTION ==="
Write-Host "Resolved: $totalResolved / $totalConfigs (${finalPct}%)"
