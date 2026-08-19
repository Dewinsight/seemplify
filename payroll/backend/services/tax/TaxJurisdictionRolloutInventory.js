'use strict';

/**
 * Explicit jurisdiction inventory for the broad UI labels that are not legal
 * payroll-tax jurisdictions. This is planning metadata only; it has no
 * calculation or publication path.
 *
 * Released platform packs are deliberately excluded. Every remaining ISO
 * country or territory is represented so employee and employer setup always
 * has a governed configuration path. An inventory entry is not a calculation
 * fallback: it starts as a non-runnable draft and must pass the ordinary
 * source, fixture and publication gates.
 */

function entry(code, name, implementationStatus = 'dynamic_pack_backlog') {
  return Object.freeze({ code, name, implementationStatus, payrollRunnable: false });
}

const DYNAMIC_CREATION_TEMPLATE = Object.freeze({
  creationMode: 'admin_create_or_clone',
  initialVersionStatus: 'draft',
  initialValidationStatus: 'draft',
  initialCalculationStatus: 'blocked',
  payrollRunnable: false,
  requiredBeforePublication: Object.freeze([
    'effective-dated calculation currency and declared coverage/exclusions',
    'primary-source snapshots with retrieval date and SHA-256 digest',
    'exact formulas, statutory bases, rounding stages and liability/remittance mappings',
    'source-bound zero, ordinary, boundary, high-income, YTD and employer-cost fixtures',
    'distinct authorized tax-law, payroll-calculation and independent-QA reviews',
    'a separate publisher who is not the author or a reviewer',
  ]),
});

const DYNAMIC_PACK_REQUIREMENTS = Object.freeze({
  EU_MEMBER_STATES: Object.freeze([
    'national income-tax withholding', 'employee and employer social security',
    'regional, municipal and church taxes where applicable', 'benefits and irregular payments',
    'EU applicable-social-security-law evidence for cross-border workers', 'filing and remittance outputs',
  ]),
  US_STATES_AND_DC: Object.freeze([
    'state income-tax withholding or evidenced no-withholding treatment', 'state unemployment insurance',
    'local income or occupational taxes', 'state disability and paid-family/medical-leave programs',
    'reciprocity, resident/worksite allocation and supplemental pay', 'filing and remittance outputs',
  ]),
  CANADA_PROVINCES_AND_TERRITORIES: Object.freeze([
    'federal T4127 companion', 'province or territory income-tax withholding',
    'CPP/CPP2 and EI or Quebec QPP/QPIP/Quebec EI treatment', 'benefits and non-periodic pay',
    'workers-compensation and other employer liabilities where in payroll scope', 'filing and remittance outputs',
  ]),
  OTHER_AMERICAS_SOVEREIGN_STATES: Object.freeze([
    'national income-tax withholding', 'employee and employer social-security systems',
    'subnational or municipal payroll liabilities where applicable', 'benefits, bonuses and termination pay',
    'worker-class, residency and expatriate rules', 'filing and remittance outputs',
  ]),
  GLOBAL_COUNTRY_OR_TERRITORY_PACKS: Object.freeze([
    'national income-tax withholding', 'employee and employer social-security systems',
    'subnational, municipal, sector and other payroll levies where applicable',
    'benefits, allowances, bonuses, termination pay and annual reconciliation',
    'worker-class, sector, age and expatriate rules', 'filing and remittance outputs',
  ]),
});

const EU_MEMBER_STATES = Object.freeze([
  entry('AT', 'Austria'), entry('BE', 'Belgium'), entry('BG', 'Bulgaria'),
  entry('HR', 'Croatia'), entry('CY', 'Cyprus'), entry('CZ', 'Czechia'),
  entry('DK', 'Denmark'), entry('EE', 'Estonia'), entry('FI', 'Finland'),
  entry('FR', 'France'), entry('DE', 'Germany'), entry('GR', 'Greece'),
  entry('HU', 'Hungary'), entry('IE', 'Ireland'), entry('IT', 'Italy'),
  entry('LV', 'Latvia'), entry('LT', 'Lithuania'), entry('LU', 'Luxembourg'),
  entry('MT', 'Malta'), entry('NL', 'Netherlands'), entry('PL', 'Poland'),
  entry('PT', 'Portugal'), entry('RO', 'Romania'), entry('SK', 'Slovakia'),
  entry('SI', 'Slovenia'), entry('ES', 'Spain'), entry('SE', 'Sweden'),
]);

const OTHER_AMERICAS_SOVEREIGN_STATES = Object.freeze([
  entry('AG', 'Antigua and Barbuda'), entry('AR', 'Argentina'), entry('BS', 'Bahamas'),
  entry('BB', 'Barbados'), entry('BZ', 'Belize'), entry('BO', 'Bolivia'),
  entry('BR', 'Brazil'), entry('CL', 'Chile'), entry('CO', 'Colombia'),
  entry('CR', 'Costa Rica'), entry('CU', 'Cuba'), entry('DM', 'Dominica'),
  entry('DO', 'Dominican Republic'), entry('EC', 'Ecuador'), entry('SV', 'El Salvador'),
  entry('GD', 'Grenada'), entry('GT', 'Guatemala'), entry('GY', 'Guyana'),
  entry('HT', 'Haiti'), entry('HN', 'Honduras'), entry('JM', 'Jamaica'),
  entry('MX', 'Mexico'), entry('NI', 'Nicaragua'), entry('PA', 'Panama'),
  entry('PY', 'Paraguay'), entry('PE', 'Peru'), entry('KN', 'Saint Kitts and Nevis'),
  entry('LC', 'Saint Lucia'), entry('VC', 'Saint Vincent and the Grenadines'),
  entry('SR', 'Suriname'), entry('TT', 'Trinidad and Tobago'), entry('UY', 'Uruguay'),
  entry('VE', 'Venezuela'),
]);

const RELEASED_PLATFORM_COUNTRY_CODES = new Set(['CM', 'GB', 'GH', 'KE', 'MZ', 'NG', 'US', 'ZA']);
const INVENTORIED_NATIONAL_COUNTRY_CODES = new Set([
  ...EU_MEMBER_STATES.map((item) => item.code),
  ...OTHER_AMERICAS_SOVEREIGN_STATES.map((item) => item.code),
]);
const ISO_COUNTRY_OR_TERRITORY_CODES = Object.freeze((
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ '
  + 'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR '
  + 'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP '
  + 'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT '
  + 'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW '
  + 'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG '
  + 'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(/\s+/));
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const GLOBAL_COUNTRY_OR_TERRITORY_PACKS = Object.freeze(
  ISO_COUNTRY_OR_TERRITORY_CODES
    .filter((code) => !RELEASED_PLATFORM_COUNTRY_CODES.has(code) && !INVENTORIED_NATIONAL_COUNTRY_CODES.has(code))
    .map((code) => entry(code, regionNames.of(code) || code))
);
// Kept as an empty compatibility export for integrations that consumed the
// former backlog group. Cameroon and Mozambique are platform releases now.
const AFRICA_FUTURE_DYNAMIC_PACKS = Object.freeze([]);

const CANADA_PROVINCES_AND_TERRITORIES = Object.freeze([
  entry('CA-AB', 'Alberta'), entry('CA-BC', 'British Columbia'),
  entry('CA-MB', 'Manitoba'), entry('CA-NB', 'New Brunswick'),
  entry('CA-NL', 'Newfoundland and Labrador'), entry('CA-NS', 'Nova Scotia'),
  entry('CA-NT', 'Northwest Territories'), entry('CA-NU', 'Nunavut'),
  entry('CA-ON', 'Ontario', 'certification_candidate'),
  entry('CA-PE', 'Prince Edward Island'), entry('CA-QC', 'Quebec'),
  entry('CA-SK', 'Saskatchewan'), entry('CA-YT', 'Yukon'),
]);

const US_STATES_AND_DC = Object.freeze([
  entry('US-AL', 'Alabama'), entry('US-AK', 'Alaska'), entry('US-AZ', 'Arizona'),
  entry('US-AR', 'Arkansas'), entry('US-CA', 'California'), entry('US-CO', 'Colorado'),
  entry('US-CT', 'Connecticut'), entry('US-DE', 'Delaware'), entry('US-DC', 'District of Columbia'),
  entry('US-FL', 'Florida'), entry('US-GA', 'Georgia'), entry('US-HI', 'Hawaii'),
  entry('US-ID', 'Idaho'), entry('US-IL', 'Illinois'), entry('US-IN', 'Indiana'),
  entry('US-IA', 'Iowa'), entry('US-KS', 'Kansas'), entry('US-KY', 'Kentucky'),
  entry('US-LA', 'Louisiana'), entry('US-ME', 'Maine'), entry('US-MD', 'Maryland'),
  entry('US-MA', 'Massachusetts'), entry('US-MI', 'Michigan'), entry('US-MN', 'Minnesota'),
  entry('US-MS', 'Mississippi'), entry('US-MO', 'Missouri'), entry('US-MT', 'Montana'),
  entry('US-NE', 'Nebraska'), entry('US-NV', 'Nevada'), entry('US-NH', 'New Hampshire'),
  entry('US-NJ', 'New Jersey'), entry('US-NM', 'New Mexico'), entry('US-NY', 'New York'),
  entry('US-NC', 'North Carolina'), entry('US-ND', 'North Dakota'), entry('US-OH', 'Ohio'),
  entry('US-OK', 'Oklahoma'), entry('US-OR', 'Oregon'), entry('US-PA', 'Pennsylvania'),
  entry('US-RI', 'Rhode Island'), entry('US-SC', 'South Carolina'), entry('US-SD', 'South Dakota'),
  entry('US-TN', 'Tennessee'), entry('US-TX', 'Texas'), entry('US-UT', 'Utah'),
  entry('US-VT', 'Vermont'), entry('US-VA', 'Virginia'), entry('US-WA', 'Washington'),
  entry('US-WV', 'West Virginia'), entry('US-WI', 'Wisconsin'), entry('US-WY', 'Wyoming'),
]);

const GROUPS = Object.freeze([
  Object.freeze({
    id: 'GLOBAL_COUNTRY_OR_TERRITORY_PACKS',
    label: 'Remaining country and territory payroll-tax systems',
    source: 'https://unstats.un.org/unsd/methodology/m49/',
    entries: GLOBAL_COUNTRY_OR_TERRITORY_PACKS,
    additionalScope: 'Every country or territory without a released platform pack has a governed setup path; local and sector liabilities must be layered where applicable.',
    requiredModules: DYNAMIC_PACK_REQUIREMENTS.GLOBAL_COUNTRY_OR_TERRITORY_PACKS,
    dynamicCreationTemplate: DYNAMIC_CREATION_TEMPLATE,
  }),
  Object.freeze({
    id: 'EU_MEMBER_STATES',
    label: 'European Union national payroll-tax systems',
    source: 'https://european-union.europa.eu/principles-countries-history/country-profiles_en',
    entries: EU_MEMBER_STATES,
    additionalScope: 'Regional, municipal, church, sector and applicable social-security law must be layered where required.',
    requiredModules: DYNAMIC_PACK_REQUIREMENTS.EU_MEMBER_STATES,
    dynamicCreationTemplate: DYNAMIC_CREATION_TEMPLATE,
  }),
  Object.freeze({
    id: 'US_STATES_AND_DC',
    label: 'United States state and District of Columbia companions',
    source: 'https://www.usa.gov/states-and-territories',
    entries: US_STATES_AND_DC,
    additionalScope: 'Local withholding, SUTA, disability, paid-leave and reciprocity rules remain separate effective-dated liabilities.',
    requiredModules: DYNAMIC_PACK_REQUIREMENTS.US_STATES_AND_DC,
    dynamicCreationTemplate: DYNAMIC_CREATION_TEMPLATE,
  }),
  Object.freeze({
    id: 'CANADA_PROVINCES_AND_TERRITORIES',
    label: 'Canadian province and territory companions',
    source: 'https://www.canada.ca/en/intergovernmental-affairs/services/provinces-territories.html',
    entries: CANADA_PROVINCES_AND_TERRITORIES,
    additionalScope: 'Each entry requires the federal companion; Quebec also requires the separate Revenu Quebec, QPP and QPIP stack.',
    requiredModules: DYNAMIC_PACK_REQUIREMENTS.CANADA_PROVINCES_AND_TERRITORIES,
    dynamicCreationTemplate: DYNAMIC_CREATION_TEMPLATE,
  }),
  Object.freeze({
    id: 'OTHER_AMERICAS_SOVEREIGN_STATES',
    label: 'Other sovereign states in the Americas',
    source: 'https://unstats.un.org/unsd/methodology/m49/',
    entries: OTHER_AMERICAS_SOVEREIGN_STATES,
    additionalScope: 'Dependencies and territories must be added separately when an employer has payroll there.',
    requiredModules: DYNAMIC_PACK_REQUIREMENTS.OTHER_AMERICAS_SOVEREIGN_STATES,
    dynamicCreationTemplate: DYNAMIC_CREATION_TEMPLATE,
  }),
]);

function getRolloutInventory() {
  return GROUPS.map((group) => Object.freeze({
    ...group,
    candidateCount: group.entries.filter((item) => item.implementationStatus === 'certification_candidate').length,
    runnableCount: group.entries.filter((item) => item.payrollRunnable).length,
  }));
}

function getDynamicPackBacklogEntry(code) {
  const normalized = String(code || '').trim().toUpperCase();
  for (const group of GROUPS) {
    const jurisdiction = group.entries.find((item) => item.code === normalized);
    if (jurisdiction) {
      return Object.freeze({
        ...jurisdiction,
        groupId: group.id,
        groupLabel: group.label,
        source: group.source,
        requiredModules: group.requiredModules,
        dynamicCreationTemplate: group.dynamicCreationTemplate,
      });
    }
  }
  return null;
}

module.exports = Object.freeze({
  EU_MEMBER_STATES,
  AFRICA_FUTURE_DYNAMIC_PACKS,
  GLOBAL_COUNTRY_OR_TERRITORY_PACKS,
  OTHER_AMERICAS_SOVEREIGN_STATES,
  CANADA_PROVINCES_AND_TERRITORIES,
  US_STATES_AND_DC,
  DYNAMIC_CREATION_TEMPLATE,
  DYNAMIC_PACK_REQUIREMENTS,
  getRolloutInventory,
  getDynamicPackBacklogEntry,
});
