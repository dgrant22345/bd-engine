param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Add-Type -Path "$root\server\vendor\sqlite\System.Data.SQLite.dll"

# Known enterprise career page mappings for companies that don't use standard ATS slugs
# These are companies with custom career portals or non-standard ATS configurations
$knownMappings = @(
    # Big tech
    @{ pattern = 'amazon'; atsType = 'custom_enterprise'; boardUrl = 'https://www.amazon.jobs/en/'; boardId = 'amazon' }
    @{ pattern = '^apple$'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.apple.com/en-us/search'; boardId = 'apple' }
    @{ pattern = 'google'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.google.com/jobs/'; boardId = 'google' }
    @{ pattern = 'microsoft'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.microsoft.com/'; boardId = 'microsoft' }
    @{ pattern = 'meta'; atsType = 'custom_enterprise'; boardUrl = 'https://www.metacareers.com/jobs'; boardId = 'meta' }
    @{ pattern = 'tesla'; atsType = 'custom_enterprise'; boardUrl = 'https://www.tesla.com/careers/search'; boardId = 'tesla' }
    @{ pattern = 'nvidia'; atsType = 'custom_enterprise'; boardUrl = 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite'; boardId = 'nvidia' }
    @{ pattern = 'salesforce'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.salesforce.com/en/jobs/'; boardId = 'salesforce' }
    @{ pattern = 'intel corporation'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.intel.com/en/search-jobs'; boardId = 'intel' }

    # Canadian banks
    @{ pattern = 'bmo'; atsType = 'workday'; boardUrl = 'https://bmo.wd3.myworkdayjobs.com/External'; boardId = 'bmo' }
    @{ pattern = 'scotiabank'; atsType = 'workday'; boardUrl = 'https://scotiabank.wd3.myworkdayjobs.com/External'; boardId = 'scotiabank' }
    @{ pattern = 'td bank'; atsType = 'workday'; boardUrl = 'https://td.wd3.myworkdayjobs.com/TD_Careers'; boardId = 'td' }
    @{ pattern = 'cibc'; atsType = 'workday'; boardUrl = 'https://cibc.wd3.myworkdayjobs.com/search'; boardId = 'cibc' }
    @{ pattern = 'rbc'; atsType = 'workday'; boardUrl = 'https://rbc.wd3.myworkdayjobs.com/RBC_Careers'; boardId = 'rbc' }
    @{ pattern = 'manulife'; atsType = 'workday'; boardUrl = 'https://manulife.wd3.myworkdayjobs.com/MFCJH_Jobs'; boardId = 'manulife' }
    @{ pattern = 'sun life'; atsType = 'workday'; boardUrl = 'https://sunlife.wd3.myworkdayjobs.com/Experienced-Careers'; boardId = 'sunlife' }
    @{ pattern = 'sunlife'; atsType = 'workday'; boardUrl = 'https://sunlife.wd3.myworkdayjobs.com/Experienced-Careers'; boardId = 'sunlife' }
    @{ pattern = 'desjardins'; atsType = 'workday'; boardUrl = 'https://desjardins.wd3.myworkdayjobs.com/External'; boardId = 'desjardins' }
    @{ pattern = 'national bank'; atsType = 'custom_enterprise'; boardUrl = 'https://www.nbc.ca/career.html'; boardId = 'nbc' }
    @{ pattern = 'laurentian bank'; atsType = 'custom_enterprise'; boardUrl = 'https://www.laurentianbank.ca/en/careers.html'; boardId = 'laurentianbank' }
    @{ pattern = 'hsbc'; atsType = 'custom_enterprise'; boardUrl = 'https://www.hsbc.com/careers/search-jobs'; boardId = 'hsbc' }

    # Consulting / Big 4
    @{ pattern = 'deloitte'; atsType = 'custom_enterprise'; boardUrl = 'https://apply.deloitte.com/careers/SearchJobs'; boardId = 'deloitte' }
    @{ pattern = 'pwc'; atsType = 'workday'; boardUrl = 'https://pwc.wd3.myworkdayjobs.com/Global_Experienced_Careers'; boardId = 'pwc' }
    @{ pattern = 'kpmg'; atsType = 'custom_enterprise'; boardUrl = 'https://home.kpmg/ca/en/home/careers.html'; boardId = 'kpmg' }
    @{ pattern = 'accenture'; atsType = 'custom_enterprise'; boardUrl = 'https://www.accenture.com/ca-en/careers/jobsearch'; boardId = 'accenture' }
    @{ pattern = 'mckinsey'; atsType = 'custom_enterprise'; boardUrl = 'https://www.mckinsey.com/careers/search-jobs'; boardId = 'mckinsey' }
    @{ pattern = 'cognizant'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.cognizant.com/global/en/search-results'; boardId = 'cognizant' }
    @{ pattern = 'capgemini'; atsType = 'workday'; boardUrl = 'https://capgemini.wd3.myworkdayjobs.com/Capgemini_Careers'; boardId = 'capgemini' }
    @{ pattern = 'wipro'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.wipro.com/search-jobs'; boardId = 'wipro' }
    @{ pattern = 'infosys'; atsType = 'custom_enterprise'; boardUrl = 'https://career.infosys.com/joblist'; boardId = 'infosys' }
    @{ pattern = 'tcs'; atsType = 'custom_enterprise'; boardUrl = 'https://ibegin.tcs.com/iBegin/jobs/search'; boardId = 'tcs' }
    @{ pattern = 'genpact'; atsType = 'custom_enterprise'; boardUrl = 'https://www.genpact.com/careers'; boardId = 'genpact' }
    @{ pattern = 'cgi'; atsType = 'custom_enterprise'; boardUrl = 'https://cgi.njoyn.com/CGI/xweb/XWeb.asp'; boardId = 'cgi' }

    # Telecom
    @{ pattern = 'bell canada'; atsType = 'workday'; boardUrl = 'https://bell.wd3.myworkdayjobs.com/BellExternalCareerSite'; boardId = 'bell' }
    @{ pattern = '^bell$'; atsType = 'workday'; boardUrl = 'https://bell.wd3.myworkdayjobs.com/BellExternalCareerSite'; boardId = 'bell' }
    @{ pattern = '^telus$'; atsType = 'workday'; boardUrl = 'https://telus.wd3.myworkdayjobs.com/careers'; boardId = 'telus' }
    @{ pattern = 'telus communications'; atsType = 'workday'; boardUrl = 'https://telus.wd3.myworkdayjobs.com/careers'; boardId = 'telus' }
    @{ pattern = 'telus health'; atsType = 'workday'; boardUrl = 'https://telus.wd3.myworkdayjobs.com/careers'; boardId = 'telus' }
    @{ pattern = 'telus business'; atsType = 'workday'; boardUrl = 'https://telus.wd3.myworkdayjobs.com/careers'; boardId = 'telus' }
    @{ pattern = 'rogers'; atsType = 'workday'; boardUrl = 'https://rogers.wd3.myworkdayjobs.com/RogersExternalCareerSite'; boardId = 'rogers' }
    @{ pattern = 'cisco'; atsType = 'workday'; boardUrl = 'https://cisco.wd1.myworkdayjobs.com/External'; boardId = 'cisco' }
    @{ pattern = 'nokia'; atsType = 'workday'; boardUrl = 'https://nokia.wd3.myworkdayjobs.com/Nokia_Careers'; boardId = 'nokia' }
    @{ pattern = 'ericsson'; atsType = 'workday'; boardUrl = 'https://ericsson.wd3.myworkdayjobs.com/Ericsson'; boardId = 'ericsson' }

    # Enterprise tech
    @{ pattern = 'ibm'; atsType = 'workday'; boardUrl = 'https://ibm.wd3.myworkdayjobs.com/External'; boardId = 'ibm' }
    @{ pattern = 'oracle'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.oracle.com/jobs/'; boardId = 'oracle' }
    @{ pattern = 'sap$'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.sap.com/search/'; boardId = 'sap' }
    @{ pattern = 'dell technologies'; atsType = 'workday'; boardUrl = 'https://dell.wd1.myworkdayjobs.com/External'; boardId = 'dell' }
    @{ pattern = 'hp canada'; atsType = 'workday'; boardUrl = 'https://hp.wd5.myworkdayjobs.com/ExternalCareerSite'; boardId = 'hp' }
    @{ pattern = '^hp$'; atsType = 'workday'; boardUrl = 'https://hp.wd5.myworkdayjobs.com/ExternalCareerSite'; boardId = 'hp' }
    @{ pattern = 'hewlett packard enterprise'; atsType = 'workday'; boardUrl = 'https://hpe.wd5.myworkdayjobs.com/Jobsite'; boardId = 'hpe' }
    @{ pattern = 'hewlett packard'; atsType = 'workday'; boardUrl = 'https://hp.wd5.myworkdayjobs.com/ExternalCareerSite'; boardId = 'hp' }
    @{ pattern = 'autodesk'; atsType = 'workday'; boardUrl = 'https://autodesk.wd1.myworkdayjobs.com/Ext'; boardId = 'autodesk' }
    @{ pattern = 'intuit'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.intuit.com/search-jobs'; boardId = 'intuit' }
    @{ pattern = 'adobe'; atsType = 'workday'; boardUrl = 'https://adobe.wd5.myworkdayjobs.com/external_experienced'; boardId = 'adobe' }
    @{ pattern = 'servicenow'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.servicenow.com/jobs/search'; boardId = 'servicenow' }
    @{ pattern = 'xerox'; atsType = 'custom_enterprise'; boardUrl = 'https://xerox.wd1.myworkdayjobs.com/XeroxExternalCareers'; boardId = 'xerox' }

    # Insurance/Financial
    @{ pattern = 'intact'; atsType = 'workday'; boardUrl = 'https://intactfc.wd3.myworkdayjobs.com/IFC_Careers'; boardId = 'intactfc' }
    @{ pattern = 'canada life'; atsType = 'workday'; boardUrl = 'https://canadalife.wd3.myworkdayjobs.com/CanadaLife_Careers'; boardId = 'canadalife' }
    @{ pattern = 'great-west lifeco'; atsType = 'workday'; boardUrl = 'https://canadalife.wd3.myworkdayjobs.com/CanadaLife_Careers'; boardId = 'canadalife' }
    @{ pattern = 'goldman sachs'; atsType = 'custom_enterprise'; boardUrl = 'https://www.goldmansachs.com/careers/find-a-job'; boardId = 'goldmansachs' }
    @{ pattern = 'jpmorgan'; atsType = 'custom_enterprise'; boardUrl = 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience'; boardId = 'jpmc' }
    @{ pattern = 'morgan stanley'; atsType = 'custom_enterprise'; boardUrl = 'https://ms.taleo.net/careersection/2/jobsearch.ftl'; boardId = 'morganstanley' }
    @{ pattern = 'wells fargo'; atsType = 'workday'; boardUrl = 'https://wellsfargo.wd5.myworkdayjobs.com/WF_External_Career_Site'; boardId = 'wellsfargo' }
    @{ pattern = 'bank of america'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.bankofamerica.com/en-us/search-results'; boardId = 'bankofamerica' }
    @{ pattern = 'american express'; atsType = 'custom_enterprise'; boardUrl = 'https://aexp.eightfold.ai/careers'; boardId = 'amex' }
    @{ pattern = 'citi$'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.citi.com/'; boardId = 'citi' }
    @{ pattern = 'barclays'; atsType = 'custom_enterprise'; boardUrl = 'https://search.jobs.barclays/'; boardId = 'barclays' }
    @{ pattern = 'deutsche bank'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.db.com/search-our-positions/'; boardId = 'deutschebank' }
    @{ pattern = 'ubs$'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.ubs.com/TGnewUI/Search/Home/Home'; boardId = 'ubs' }
    @{ pattern = 'mastercard'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.mastercard.com/us/en/search-results'; boardId = 'mastercard' }
    @{ pattern = 'fidelity'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.fidelity.com/'; boardId = 'fidelity' }

    # Pharma/Healthcare
    @{ pattern = 'pfizer'; atsType = 'workday'; boardUrl = 'https://pfizer.wd1.myworkdayjobs.com/PfizerCareers'; boardId = 'pfizer' }
    @{ pattern = 'roche'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.roche.com/global/en/search-results'; boardId = 'roche' }
    @{ pattern = 'johnson and johnson'; atsType = 'custom_enterprise'; boardUrl = 'https://www.careers.jnj.com/search-jobs'; boardId = 'jnj' }
    @{ pattern = 'astrazeneca'; atsType = 'workday'; boardUrl = 'https://astrazeneca.wd3.myworkdayjobs.com/Careers'; boardId = 'astrazeneca' }
    @{ pattern = 'sanofi'; atsType = 'workday'; boardUrl = 'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers'; boardId = 'sanofi' }
    @{ pattern = 'gsk'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.gsk.com/en-gb/jobs'; boardId = 'gsk' }
    @{ pattern = 'amgen'; atsType = 'workday'; boardUrl = 'https://amgen.wd1.myworkdayjobs.com/Careers'; boardId = 'amgen' }
    @{ pattern = 'thermo fisher'; atsType = 'workday'; boardUrl = 'https://thermofisher.wd1.myworkdayjobs.com/External'; boardId = 'thermofisher' }

    # Retail/Consumer
    @{ pattern = 'walmart'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.walmart.com/'; boardId = 'walmart' }
    @{ pattern = 'the home depot'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.homedepot.ca/'; boardId = 'homedepot' }
    @{ pattern = 'canadian tire'; atsType = 'workday'; boardUrl = 'https://canadiantire.wd3.myworkdayjobs.com/CT_Careers'; boardId = 'canadiantire' }
    @{ pattern = 'loblaw'; atsType = 'workday'; boardUrl = 'https://loblaw.wd3.myworkdayjobs.com/Loblaw_Careers'; boardId = 'loblaw' }
    @{ pattern = 'shoppers drug mart'; atsType = 'workday'; boardUrl = 'https://loblaw.wd3.myworkdayjobs.com/Loblaw_Careers'; boardId = 'loblaw' }
    @{ pattern = 'sobeys'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.sobeys.com/search-results'; boardId = 'sobeys' }
    @{ pattern = 'sephora'; atsType = 'workday'; boardUrl = 'https://sephora.wd5.myworkdayjobs.com/sephora'; boardId = 'sephora' }

    # Government / Crown corps
    @{ pattern = 'government of canada'; atsType = 'custom_enterprise'; boardUrl = 'https://emploisfp-psjobs.cfp-psc.gc.ca/psrs-srfp/applicant/page1800'; boardId = 'gc-jobs' }
    @{ pattern = 'canada revenue agency'; atsType = 'custom_enterprise'; boardUrl = 'https://emploisfp-psjobs.cfp-psc.gc.ca/psrs-srfp/applicant/page1800'; boardId = 'gc-cra' }
    @{ pattern = 'canada post'; atsType = 'custom_enterprise'; boardUrl = 'https://www.canadapost-postescanada.ca/cpc/en/our-company/jobs.page'; boardId = 'canadapost' }
    @{ pattern = 'government of ontario'; atsType = 'custom_enterprise'; boardUrl = 'https://www.gojobs.gov.on.ca/Search.aspx'; boardId = 'ontario-gov' }
    @{ pattern = 'ontario public service'; atsType = 'custom_enterprise'; boardUrl = 'https://www.gojobs.gov.on.ca/Search.aspx'; boardId = 'ontario-gov' }
    @{ pattern = 'ontario ministry'; atsType = 'custom_enterprise'; boardUrl = 'https://www.gojobs.gov.on.ca/Search.aspx'; boardId = 'ontario-gov' }
    @{ pattern = 'ontario health'; atsType = 'custom_enterprise'; boardUrl = 'https://www.ontariohealth.ca/careers'; boardId = 'ontariohealth' }
    @{ pattern = 'city of toronto'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.toronto.ca/jobsatcity/search'; boardId = 'toronto' }
    @{ pattern = 'city of ottawa'; atsType = 'custom_enterprise'; boardUrl = 'https://ottawa.ca/en/city-hall/jobs-city/current-job-opportunities'; boardId = 'ottawa' }
    @{ pattern = 'city of calgary'; atsType = 'custom_enterprise'; boardUrl = 'https://www.calgary.ca/our-careers.html'; boardId = 'calgary' }
    @{ pattern = 'city of hamilton'; atsType = 'custom_enterprise'; boardUrl = 'https://www.hamilton.ca/people-programs/jobs-city/current-job-opportunities'; boardId = 'hamilton' }
    @{ pattern = 'city of brampton'; atsType = 'custom_enterprise'; boardUrl = 'https://www.brampton.ca/EN/City-Hall/Employment/Pages/Welcome.aspx'; boardId = 'brampton' }
    @{ pattern = 'city of mississauga'; atsType = 'custom_enterprise'; boardUrl = 'https://www.mississauga.ca/careers/'; boardId = 'mississauga' }
    @{ pattern = 'city of markham'; atsType = 'custom_enterprise'; boardUrl = 'https://www.markham.ca/careers'; boardId = 'markham' }
    @{ pattern = 'city of burlington'; atsType = 'custom_enterprise'; boardUrl = 'https://www.burlington.ca/en/your-city/careers.aspx'; boardId = 'burlington' }
    @{ pattern = 'hydro one'; atsType = 'custom_enterprise'; boardUrl = 'https://www.hydroone.com/careers'; boardId = 'hydroone' }
    @{ pattern = 'ontario power generation'; atsType = 'custom_enterprise'; boardUrl = 'https://www.opg.com/careers/'; boardId = 'opg' }
    @{ pattern = 'metrolinx'; atsType = 'custom_enterprise'; boardUrl = 'https://www.metrolinx.com/en/careers'; boardId = 'metrolinx' }
    @{ pattern = 'bc hydro'; atsType = 'custom_enterprise'; boardUrl = 'https://app.bchydro.com/careers.html'; boardId = 'bchydro' }
    @{ pattern = 'canada mortgage'; atsType = 'custom_enterprise'; boardUrl = 'https://www.cmhc-schl.gc.ca/about-cmhc/careers'; boardId = 'cmhc' }

    # Transport
    @{ pattern = 'air canada'; atsType = 'workday'; boardUrl = 'https://aircanada.wd3.myworkdayjobs.com/External'; boardId = 'aircanada' }
    @{ pattern = 'westjet'; atsType = 'workday'; boardUrl = 'https://westjet.wd3.myworkdayjobs.com/WestJetCareers'; boardId = 'westjet' }
    @{ pattern = 'bombardier'; atsType = 'workday'; boardUrl = 'https://bombardier.wd3.myworkdayjobs.com/Bombardier_Careers'; boardId = 'bombardier' }
    @{ pattern = 'cn$'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.cn.ca/search-jobs/'; boardId = 'cn' }
    @{ pattern = 'toronto transit'; atsType = 'custom_enterprise'; boardUrl = 'https://www.ttc.ca/jobs/external-postings'; boardId = 'ttc' }

    # Other major employers
    @{ pattern = 'adp$'; atsType = 'workday'; boardUrl = 'https://adp.wd5.myworkdayjobs.com/ADP_Careers'; boardId = 'adp' }
    @{ pattern = 'siemens'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.siemens.com/careers'; boardId = 'siemens' }
    @{ pattern = 'ford motor'; atsType = 'workday'; boardUrl = 'https://efds.fa.em5.oraclecloud.com/hcmUI/CandidateExperience'; boardId = 'ford' }
    @{ pattern = 'toyota'; atsType = 'custom_enterprise'; boardUrl = 'https://www.toyota.ca/toyota/en/careers'; boardId = 'toyota' }
    @{ pattern = 'honda canada'; atsType = 'custom_enterprise'; boardUrl = 'https://www.honda.ca/careers'; boardId = 'honda' }
    @{ pattern = 'shell$'; atsType = 'custom_enterprise'; boardUrl = 'https://www.shell.com/careers/browse-jobs.html'; boardId = 'shell' }
    @{ pattern = 'eaton$'; atsType = 'custom_enterprise'; boardUrl = 'https://eaton.eightfold.ai/careers'; boardId = 'eaton' }
    @{ pattern = 'stantec'; atsType = 'workday'; boardUrl = 'https://stantec.wd3.myworkdayjobs.com/Stantec_Careers'; boardId = 'stantec' }
    @{ pattern = 'aecon'; atsType = 'custom_enterprise'; boardUrl = 'https://aecon.com/careers'; boardId = 'aecon' }
    @{ pattern = 'nutrien'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.nutrien.com/search-results'; boardId = 'nutrien' }
    @{ pattern = 'suncor'; atsType = 'custom_enterprise'; boardUrl = 'https://www.suncor.com/careers'; boardId = 'suncor' }
    @{ pattern = 'brookfield'; atsType = 'workday'; boardUrl = 'https://brookfield.wd5.myworkdayjobs.com/Brookfield_Careers'; boardId = 'brookfield' }
    @{ pattern = 'magna'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.magna.com/search-jobs'; boardId = 'magna' }
    @{ pattern = 'cbre'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.cbre.com/en/jobs/'; boardId = 'cbre' }
    @{ pattern = 'jll$'; atsType = 'workday'; boardUrl = 'https://jll.wd1.myworkdayjobs.com/jllcareers'; boardId = 'jll' }
    @{ pattern = 'palo alto networks'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.paloaltonetworks.com/en/jobs/'; boardId = 'paloalto' }
    @{ pattern = 'crowdstrike'; atsType = 'custom_enterprise'; boardUrl = 'https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers'; boardId = 'crowdstrike' }
    @{ pattern = 'fortinet'; atsType = 'custom_enterprise'; boardUrl = 'https://edel.fa.us2.oraclecloud.com/hcmUI/CandidateExperience'; boardId = 'fortinet' }
    @{ pattern = 'zendesk'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.zendesk.com/us/en/search-results'; boardId = 'zendesk' }
    @{ pattern = 'zoom$'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.zoom.us/jobs/search'; boardId = 'zoom' }
    @{ pattern = 'yelp'; atsType = 'custom_enterprise'; boardUrl = 'https://www.yelp.careers/us/en/search-results'; boardId = 'yelp' }
    @{ pattern = 'unity$'; atsType = 'greenhouse'; boardUrl = 'https://boards-api.greenhouse.io/v1/boards/unity3d/jobs?content=true'; boardId = 'unity3d' }
    @{ pattern = 'rivian'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.rivian.com/search/jobs'; boardId = 'rivian' }
    @{ pattern = 'veeva systems'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.veeva.com/search/jobs'; boardId = 'veeva' }
    @{ pattern = 'red hat'; atsType = 'custom_enterprise'; boardUrl = 'https://redhat.wd5.myworkdayjobs.com/Jobs'; boardId = 'redhat' }
    @{ pattern = 'broadcom'; atsType = 'workday'; boardUrl = 'https://broadcom.wd1.myworkdayjobs.com/External_Career'; boardId = 'broadcom' }
    @{ pattern = 'qualcomm'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.qualcomm.com/careers'; boardId = 'qualcomm' }
    @{ pattern = 'lenovo'; atsType = 'workday'; boardUrl = 'https://lenovo.wd1.myworkdayjobs.com/Lenovo_Careers'; boardId = 'lenovo' }
    @{ pattern = 'robert half'; atsType = 'custom_enterprise'; boardUrl = 'https://www.roberthalf.com/us/en/jobs'; boardId = 'roberthalf' }
    @{ pattern = 'concentrix'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.concentrix.com/global/en/search-results'; boardId = 'concentrix' }
    @{ pattern = 'accenture'; atsType = 'custom_enterprise'; boardUrl = 'https://www.accenture.com/ca-en/careers/jobsearch'; boardId = 'accenture' }
    @{ pattern = 'slalom'; atsType = 'custom_enterprise'; boardUrl = 'https://www.slalom.com/careers'; boardId = 'slalom' }
    @{ pattern = 'equifax'; atsType = 'workday'; boardUrl = 'https://equifax.wd5.myworkdayjobs.com/External'; boardId = 'equifax' }
    @{ pattern = 'transunion'; atsType = 'custom_enterprise'; boardUrl = 'https://transunion.wd5.myworkdayjobs.com/TransUnion'; boardId = 'transunion' }
    @{ pattern = 'thomson reuters'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.thomsonreuters.com/us/en/search-results'; boardId = 'thomsonreuters' }
    @{ pattern = 'aon$'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.aon.com/search-jobs'; boardId = 'aon' }
    @{ pattern = 'marsh mclennan'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.marshmclennan.com/global/en/search-results'; boardId = 'marshmclennan' }

    # Universities / Education
    @{ pattern = 'york university'; atsType = 'custom_enterprise'; boardUrl = 'https://www.yorku.ca/jobs/'; boardId = 'yorku' }
    @{ pattern = 'university of toronto'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.utoronto.ca/search-jobs'; boardId = 'uoft' }
    @{ pattern = 'queen.s university'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.queensu.ca/search/'; boardId = 'queensu' }

    # Other
    @{ pattern = 'clio$'; atsType = 'greenhouse'; boardUrl = 'https://boards-api.greenhouse.io/v1/boards/caboratoryinc/jobs?content=true'; boardId = 'caboratoryinc' }
    @{ pattern = 'arc.teryx'; atsType = 'workday'; boardUrl = 'https://arcteryx.wd3.myworkdayjobs.com/External'; boardId = 'arcteryx' }
    @{ pattern = 'canada goose'; atsType = 'workday'; boardUrl = 'https://canadagoose.wd3.myworkdayjobs.com/Careers'; boardId = 'canadagoose' }
    @{ pattern = 'kinaxis'; atsType = 'custom_enterprise'; boardUrl = 'https://www.kinaxis.com/en/careers/job-openings'; boardId = 'kinaxis' }
    @{ pattern = 'dayforce'; atsType = 'custom_enterprise'; boardUrl = 'https://www.dayforce.com/careers'; boardId = 'dayforce' }
    @{ pattern = 'ceridian'; atsType = 'custom_enterprise'; boardUrl = 'https://www.dayforce.com/careers'; boardId = 'dayforce' }
    @{ pattern = 'arctic wolf'; atsType = 'custom_enterprise'; boardUrl = 'https://arcticwolf.wd1.myworkdayjobs.com/External'; boardId = 'arcticwolf' }
    @{ pattern = 'neo financial'; atsType = 'lever'; boardUrl = 'https://jobs.lever.co/neofinancial'; boardId = 'neofinancial' }
    @{ pattern = 'softchoice'; atsType = 'workday'; boardUrl = 'https://softchoice.wd3.myworkdayjobs.com/Softchoice_Careers'; boardId = 'softchoice' }
    @{ pattern = 'electronic arts'; atsType = 'custom_enterprise'; boardUrl = 'https://ea.gr8people.com/jobs'; boardId = 'ea' }
    @{ pattern = 'mars$'; atsType = 'custom_enterprise'; boardUrl = 'https://careers.mars.com/global/en/search-results'; boardId = 'mars' }
    @{ pattern = 'wealthsimple'; atsType = 'lever'; boardUrl = 'https://jobs.lever.co/wealthsimple'; boardId = 'wealthsimple' }
    @{ pattern = '^revolut$'; atsType = 'custom_enterprise'; boardUrl = 'https://www.revolut.com/careers/'; boardId = 'revolut' }
    @{ pattern = 'holt renfrew'; atsType = 'workday'; boardUrl = 'https://holtrenfrew.wd3.myworkdayjobs.com/HoltRenfrew_Careers'; boardId = 'holtrenfrew' }
    @{ pattern = 'lcbo'; atsType = 'custom_enterprise'; boardUrl = 'https://www.lcbo.com/content/lcbo/en/corporate-pages/careers.html'; boardId = 'lcbo' }
    @{ pattern = 'mccain foods'; atsType = 'workday'; boardUrl = 'https://mccain.wd3.myworkdayjobs.com/External'; boardId = 'mccain' }
    @{ pattern = 'canada nuclear'; atsType = 'custom_enterprise'; boardUrl = 'https://www.cnl.ca/careers/'; boardId = 'cnl' }
    @{ pattern = 'gardaworld'; atsType = 'custom_enterprise'; boardUrl = 'https://jobs.gardaworld.com/search-results'; boardId = 'gardaworld' }
    @{ pattern = 'cpp investments'; atsType = 'workday'; boardUrl = 'https://cppib.wd3.myworkdayjobs.com/CPPIB_Careers'; boardId = 'cppib' }
    @{ pattern = 'omers'; atsType = 'workday'; boardUrl = 'https://omers.wd3.myworkdayjobs.com/OMERS_External'; boardId = 'omers' }
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

Write-Host "Found $($configs.Count) no-match configs to check against known mappings"

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
            $activeJson = if ($supportedInt -eq 1) { "true" } else { "false" }
            $safeEvidence = "Known enterprise mapping for $name"
            $updateCmd.CommandText = @"
UPDATE board_configs SET
  ats_type = '$atsType',
  board_id = '$boardId',
  resolved_board_url = '$boardUrl',
  active = $supportedInt,
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
    '$.active', json('$activeJson'),
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
Write-Host "=== KNOWN ENTERPRISE MAPPING COMPLETE ==="
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
