/**
 * Mapping from runtime city ids (rt-<zone>) to ISO 3166-1 alpha-2 country codes.
 * Derived from IANA zone.tab (~400 primary zones) plus tz-lookup legacy aliases.
 * Bundled statically for honest country-level fallback names (BRAWUKA-695).
 */

const ZONE_SLUG_TO_COUNTRY: Readonly<Record<string, string>> = Object.freeze({
  "rt-africa-abidjan": "CI", "rt-africa-accra": "GH", "rt-africa-addis_ababa": "ET",
  "rt-africa-algiers": "DZ", "rt-africa-asmara": "ER", "rt-africa-bamako": "ML",
  "rt-africa-bangui": "CF", "rt-africa-banjul": "GM", "rt-africa-bissau": "GW",
  "rt-africa-blantyre": "MW", "rt-africa-brazzaville": "CG", "rt-africa-bujumbura": "BI",
  "rt-africa-cairo": "EG", "rt-africa-casablanca": "MA", "rt-africa-ceuta": "ES",
  "rt-africa-conakry": "GN", "rt-africa-dakar": "SN", "rt-africa-dar_es_salaam": "TZ",
  "rt-africa-djibouti": "DJ", "rt-africa-douala": "CM", "rt-africa-el_aaiun": "EH",
  "rt-africa-freetown": "SL", "rt-africa-gaborone": "BW", "rt-africa-harare": "ZW",
  "rt-africa-johannesburg": "ZA", "rt-africa-juba": "SS", "rt-africa-kampala": "UG",
  "rt-africa-khartoum": "SD", "rt-africa-kigali": "RW", "rt-africa-kinshasa": "CD",
  "rt-africa-lagos": "NG", "rt-africa-libreville": "GA", "rt-africa-lome": "TG",
  "rt-africa-luanda": "AO", "rt-africa-lubumbashi": "CD", "rt-africa-lusaka": "ZM",
  "rt-africa-malabo": "GQ", "rt-africa-maputo": "MZ", "rt-africa-maseru": "LS",
  "rt-africa-mbabane": "SZ", "rt-africa-mogadishu": "SO", "rt-africa-monrovia": "LR",
  "rt-africa-nairobi": "KE", "rt-africa-ndjamena": "TD", "rt-africa-niamey": "NE",
  "rt-africa-nouakchott": "MR", "rt-africa-ouagadougou": "BF", "rt-africa-porto-novo": "BJ",
  "rt-africa-sao_tome": "ST", "rt-africa-tripoli": "LY", "rt-africa-tunis": "TN",
  "rt-africa-windhoek": "NA", "rt-america-adak": "US", "rt-america-anchorage": "US",
  "rt-america-anguilla": "AI", "rt-america-antigua": "AG", "rt-america-araguaina": "BR",
  "rt-america-argentina-buenos_aires": "AR", "rt-america-argentina-catamarca": "AR", "rt-america-argentina-cordoba": "AR",
  "rt-america-argentina-jujuy": "AR", "rt-america-argentina-la_rioja": "AR", "rt-america-argentina-mendoza": "AR",
  "rt-america-argentina-rio_gallegos": "AR", "rt-america-argentina-salta": "AR", "rt-america-argentina-san_juan": "AR",
  "rt-america-argentina-san_luis": "AR", "rt-america-argentina-tucuman": "AR", "rt-america-argentina-ushuaia": "AR",
  "rt-america-aruba": "AW", "rt-america-asuncion": "PY", "rt-america-atikokan": "CA",
  "rt-america-bahia": "BR", "rt-america-bahia_banderas": "MX", "rt-america-barbados": "BB",
  "rt-america-belem": "BR", "rt-america-belize": "BZ", "rt-america-blanc-sablon": "CA",
  "rt-america-boa_vista": "BR", "rt-america-bogota": "CO", "rt-america-boise": "US",
  "rt-america-cambridge_bay": "CA", "rt-america-campo_grande": "BR", "rt-america-cancun": "MX",
  "rt-america-caracas": "VE", "rt-america-cayenne": "GF", "rt-america-cayman": "KY",
  "rt-america-chicago": "US", "rt-america-chihuahua": "MX", "rt-america-ciudad_juarez": "MX",
  "rt-america-costa_rica": "CR", "rt-america-coyhaique": "CL", "rt-america-creston": "CA",
  "rt-america-cuiaba": "BR", "rt-america-curacao": "CW", "rt-america-danmarkshavn": "GL",
  "rt-america-dawson": "CA", "rt-america-dawson_creek": "CA", "rt-america-denver": "US",
  "rt-america-detroit": "US", "rt-america-dominica": "DM", "rt-america-edmonton": "CA",
  "rt-america-eirunepe": "BR", "rt-america-el_salvador": "SV", "rt-america-fort_nelson": "CA",
  "rt-america-fortaleza": "BR", "rt-america-glace_bay": "CA", "rt-america-godthab": "GL",
  "rt-america-goose_bay": "CA", "rt-america-grand_turk": "TC", "rt-america-grenada": "GD",
  "rt-america-guadeloupe": "GP", "rt-america-guatemala": "GT", "rt-america-guayaquil": "EC",
  "rt-america-guyana": "GY", "rt-america-halifax": "CA", "rt-america-havana": "CU",
  "rt-america-hermosillo": "MX", "rt-america-indiana-indianapolis": "US", "rt-america-indiana-knox": "US",
  "rt-america-indiana-marengo": "US", "rt-america-indiana-petersburg": "US", "rt-america-indiana-tell_city": "US",
  "rt-america-indiana-vevay": "US", "rt-america-indiana-vincennes": "US", "rt-america-indiana-winamac": "US",
  "rt-america-inuvik": "CA", "rt-america-iqaluit": "CA", "rt-america-jamaica": "JM",
  "rt-america-juneau": "US", "rt-america-kentucky-louisville": "US", "rt-america-kentucky-monticello": "US",
  "rt-america-kralendijk": "BQ", "rt-america-la_paz": "BO", "rt-america-lima": "PE",
  "rt-america-los_angeles": "US", "rt-america-lower_princes": "SX", "rt-america-maceio": "BR",
  "rt-america-managua": "NI", "rt-america-manaus": "BR", "rt-america-marigot": "MF",
  "rt-america-martinique": "MQ", "rt-america-matamoros": "MX", "rt-america-mazatlan": "MX",
  "rt-america-menominee": "US", "rt-america-merida": "MX", "rt-america-metlakatla": "US",
  "rt-america-mexico_city": "MX", "rt-america-miquelon": "PM", "rt-america-moncton": "CA",
  "rt-america-monterrey": "MX", "rt-america-montevideo": "UY", "rt-america-montserrat": "MS",
  "rt-america-nassau": "BS", "rt-america-new_york": "US", "rt-america-nome": "US",
  "rt-america-noronha": "BR", "rt-america-north_dakota-beulah": "US", "rt-america-north_dakota-center": "US",
  "rt-america-north_dakota-new_salem": "US", "rt-america-nuuk": "GL", "rt-america-ojinaga": "MX",
  "rt-america-panama": "PA", "rt-america-pangnirtung": "CA", "rt-america-paramaribo": "SR",
  "rt-america-phoenix": "US", "rt-america-port-au-prince": "HT", "rt-america-port_of_spain": "TT",
  "rt-america-porto_velho": "BR", "rt-america-puerto_rico": "PR", "rt-america-punta_arenas": "CL",
  "rt-america-rankin_inlet": "CA", "rt-america-recife": "BR", "rt-america-regina": "CA",
  "rt-america-resolute": "CA", "rt-america-rio_branco": "BR", "rt-america-santarem": "BR",
  "rt-america-santiago": "CL", "rt-america-santo_domingo": "DO", "rt-america-sao_paulo": "BR",
  "rt-america-scoresbysund": "GL", "rt-america-sitka": "US", "rt-america-st_barthelemy": "BL",
  "rt-america-st_johns": "CA", "rt-america-st_kitts": "KN", "rt-america-st_lucia": "LC",
  "rt-america-st_thomas": "VI", "rt-america-st_vincent": "VC", "rt-america-swift_current": "CA",
  "rt-america-tegucigalpa": "HN", "rt-america-thule": "GL", "rt-america-thunder_bay": "CA",
  "rt-america-tijuana": "MX", "rt-america-toronto": "CA", "rt-america-tortola": "VG",
  "rt-america-vancouver": "CA", "rt-america-whitehorse": "CA", "rt-america-winnipeg": "CA",
  "rt-america-yakutat": "US", "rt-america-yellowknife": "CA", "rt-antarctica-casey": "AQ",
  "rt-antarctica-davis": "AQ", "rt-antarctica-dumontdurville": "AQ", "rt-antarctica-macquarie": "AU",
  "rt-antarctica-mawson": "AQ", "rt-antarctica-mcmurdo": "AQ", "rt-antarctica-palmer": "AQ",
  "rt-antarctica-rothera": "AQ", "rt-antarctica-syowa": "AQ", "rt-antarctica-troll": "AQ",
  "rt-antarctica-vostok": "AQ", "rt-arctic-longyearbyen": "SJ", "rt-asia-aden": "YE",
  "rt-asia-almaty": "KZ", "rt-asia-amman": "JO", "rt-asia-anadyr": "RU",
  "rt-asia-aqtau": "KZ", "rt-asia-aqtobe": "KZ", "rt-asia-ashgabat": "TM",
  "rt-asia-atyrau": "KZ", "rt-asia-baghdad": "IQ", "rt-asia-bahrain": "BH",
  "rt-asia-baku": "AZ", "rt-asia-bangkok": "TH", "rt-asia-barnaul": "RU",
  "rt-asia-beirut": "LB", "rt-asia-bishkek": "KG", "rt-asia-brunei": "BN",
  "rt-asia-chita": "RU", "rt-asia-choibalsan": "MN", "rt-asia-colombo": "LK",
  "rt-asia-damascus": "SY", "rt-asia-dhaka": "BD", "rt-asia-dili": "TL",
  "rt-asia-dubai": "AE", "rt-asia-dushanbe": "TJ", "rt-asia-famagusta": "CY",
  "rt-asia-gaza": "PS", "rt-asia-hebron": "PS", "rt-asia-ho_chi_minh": "VN",
  "rt-asia-hong_kong": "HK", "rt-asia-hovd": "MN", "rt-asia-irkutsk": "RU",
  "rt-asia-jakarta": "ID", "rt-asia-jayapura": "ID", "rt-asia-jerusalem": "IL",
  "rt-asia-kabul": "AF", "rt-asia-kamchatka": "RU", "rt-asia-karachi": "PK",
  "rt-asia-kathmandu": "NP", "rt-asia-khandyga": "RU", "rt-asia-kolkata": "IN",
  "rt-asia-krasnoyarsk": "RU", "rt-asia-kuala_lumpur": "MY", "rt-asia-kuching": "MY",
  "rt-asia-kuwait": "KW", "rt-asia-macau": "MO", "rt-asia-magadan": "RU",
  "rt-asia-makassar": "ID", "rt-asia-manila": "PH", "rt-asia-muscat": "OM",
  "rt-asia-nicosia": "CY", "rt-asia-novokuznetsk": "RU", "rt-asia-novosibirsk": "RU",
  "rt-asia-omsk": "RU", "rt-asia-oral": "KZ", "rt-asia-phnom_penh": "KH",
  "rt-asia-pontianak": "ID", "rt-asia-pyongyang": "KP", "rt-asia-qatar": "QA",
  "rt-asia-qostanay": "KZ", "rt-asia-qyzylorda": "KZ", "rt-asia-riyadh": "SA",
  "rt-asia-sakhalin": "RU", "rt-asia-samarkand": "UZ", "rt-asia-seoul": "KR",
  "rt-asia-shanghai": "CN", "rt-asia-singapore": "SG", "rt-asia-srednekolymsk": "RU",
  "rt-asia-taipei": "TW", "rt-asia-tashkent": "UZ", "rt-asia-tbilisi": "GE",
  "rt-asia-tehran": "IR", "rt-asia-thimphu": "BT", "rt-asia-tokyo": "JP",
  "rt-asia-tomsk": "RU", "rt-asia-ulaanbaatar": "MN", "rt-asia-urumqi": "CN",
  "rt-asia-ust-nera": "RU", "rt-asia-vientiane": "LA", "rt-asia-vladivostok": "RU",
  "rt-asia-yakutsk": "RU", "rt-asia-yangon": "MM", "rt-asia-yekaterinburg": "RU",
  "rt-asia-yerevan": "AM", "rt-atlantic-azores": "PT", "rt-atlantic-bermuda": "BM",
  "rt-atlantic-canary": "ES", "rt-atlantic-cape_verde": "CV", "rt-atlantic-faroe": "FO",
  "rt-atlantic-madeira": "PT", "rt-atlantic-reykjavik": "IS", "rt-atlantic-south_georgia": "GS",
  "rt-atlantic-st_helena": "SH", "rt-atlantic-stanley": "FK", "rt-australia-adelaide": "AU",
  "rt-australia-brisbane": "AU", "rt-australia-broken_hill": "AU", "rt-australia-currie": "AU",
  "rt-australia-darwin": "AU", "rt-australia-eucla": "AU", "rt-australia-hobart": "AU",
  "rt-australia-lindeman": "AU", "rt-australia-lord_howe": "AU", "rt-australia-melbourne": "AU",
  "rt-australia-perth": "AU", "rt-australia-sydney": "AU", "rt-europe-amsterdam": "NL",
  "rt-europe-andorra": "AD", "rt-europe-astrakhan": "RU", "rt-europe-athens": "GR",
  "rt-europe-belgrade": "RS", "rt-europe-berlin": "DE", "rt-europe-bratislava": "SK",
  "rt-europe-brussels": "BE", "rt-europe-bucharest": "RO", "rt-europe-budapest": "HU",
  "rt-europe-busingen": "DE", "rt-europe-chisinau": "MD", "rt-europe-copenhagen": "DK",
  "rt-europe-dublin": "IE", "rt-europe-gibraltar": "GI", "rt-europe-guernsey": "GG",
  "rt-europe-helsinki": "FI", "rt-europe-isle_of_man": "IM", "rt-europe-istanbul": "TR",
  "rt-europe-jersey": "JE", "rt-europe-kaliningrad": "RU", "rt-europe-kiev": "UA",
  "rt-europe-kirov": "RU", "rt-europe-kyiv": "UA", "rt-europe-lisbon": "PT",
  "rt-europe-ljubljana": "SI", "rt-europe-london": "GB", "rt-europe-luxembourg": "LU",
  "rt-europe-madrid": "ES", "rt-europe-malta": "MT", "rt-europe-mariehamn": "AX",
  "rt-europe-minsk": "BY", "rt-europe-monaco": "MC", "rt-europe-moscow": "RU",
  "rt-europe-oslo": "NO", "rt-europe-paris": "FR", "rt-europe-podgorica": "ME",
  "rt-europe-prague": "CZ", "rt-europe-riga": "LV", "rt-europe-rome": "IT",
  "rt-europe-samara": "RU", "rt-europe-san_marino": "SM", "rt-europe-sarajevo": "BA",
  "rt-europe-saratov": "RU", "rt-europe-simferopol": "UA", "rt-europe-skopje": "MK",
  "rt-europe-sofia": "BG", "rt-europe-stockholm": "SE", "rt-europe-tallinn": "EE",
  "rt-europe-tirane": "AL", "rt-europe-ulyanovsk": "RU", "rt-europe-uzhgorod": "UA",
  "rt-europe-vaduz": "LI", "rt-europe-vatican": "VA", "rt-europe-vienna": "AT",
  "rt-europe-vilnius": "LT", "rt-europe-volgograd": "RU", "rt-europe-warsaw": "PL",
  "rt-europe-zagreb": "HR", "rt-europe-zaporozhye": "UA", "rt-europe-zurich": "CH",
  "rt-indian-antananarivo": "MG", "rt-indian-chagos": "IO", "rt-indian-christmas": "CX",
  "rt-indian-cocos": "CC", "rt-indian-comoro": "KM", "rt-indian-kerguelen": "TF",
  "rt-indian-mahe": "SC", "rt-indian-maldives": "MV", "rt-indian-mauritius": "MU",
  "rt-indian-mayotte": "YT", "rt-indian-reunion": "RE", "rt-pacific-apia": "WS",
  "rt-pacific-auckland": "NZ", "rt-pacific-bougainville": "PG", "rt-pacific-chatham": "NZ",
  "rt-pacific-chuuk": "FM", "rt-pacific-easter": "CL", "rt-pacific-efate": "VU",
  "rt-pacific-enderbury": "KI", "rt-pacific-fakaofo": "TK", "rt-pacific-fiji": "FJ",
  "rt-pacific-funafuti": "TV", "rt-pacific-galapagos": "EC", "rt-pacific-gambier": "PF",
  "rt-pacific-guadalcanal": "SB", "rt-pacific-guam": "GU", "rt-pacific-honolulu": "US",
  "rt-pacific-kanton": "KI", "rt-pacific-kiritimati": "KI", "rt-pacific-kosrae": "FM",
  "rt-pacific-kwajalein": "MH", "rt-pacific-majuro": "MH", "rt-pacific-marquesas": "PF",
  "rt-pacific-midway": "UM", "rt-pacific-nauru": "NR", "rt-pacific-niue": "NU",
  "rt-pacific-norfolk": "NF", "rt-pacific-noumea": "NC", "rt-pacific-pago_pago": "AS",
  "rt-pacific-palau": "PW", "rt-pacific-pitcairn": "PN", "rt-pacific-pohnpei": "FM",
  "rt-pacific-port_moresby": "PG", "rt-pacific-rarotonga": "CK", "rt-pacific-saipan": "MP",
  "rt-pacific-tahiti": "PF", "rt-pacific-tarawa": "KI", "rt-pacific-tongatapu": "TO",
  "rt-pacific-wake": "UM", "rt-pacific-wallis": "WF",
});

/**
 * Resolves ISO 3166-1 alpha-2 country code from an IANA timezone string.
 * Returns null for Etc/* or unmapped zones.
 */
export function getCountryCodeForTimezone(tz: string): string | null {
  if (!tz || tz.startsWith("Etc/") || tz === "UTC") return null;
  const rtId = "rt-" + tz.toLowerCase().replace(/\//g, "-");
  return ZONE_SLUG_TO_COUNTRY[rtId] ?? null;
}

/**
 * Resolves ISO 3166-1 alpha-2 country code from a runtime city id (rt-<zone>).
 * Returns null for non-runtime or unmapped ids.
 */
export function getCountryCodeForRuntimeCityId(cityId: string): string | null {
  if (!cityId || !cityId.startsWith("rt-")) return null;
  return ZONE_SLUG_TO_COUNTRY[cityId] ?? null;
}

/**
 * Returns localized country/region display name using Intl.DisplayNames.
 * Falls back to null on failure.
 */
export function getLocalizedCountryName(
  countryCode: string,
  locale: string,
): string | null {
  try {
    const displayNames = new Intl.DisplayNames([locale || "en", "en"], {
      type: "region",
    });
    return displayNames.of(countryCode) ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns localized country name for a runtime city id (rt-<zone>).
 */
export function getLocalizedCountryNameForRuntimeId(
  cityId: string,
  locale: string,
): string | null {
  const code = getCountryCodeForRuntimeCityId(cityId);
  if (!code) return null;
  return getLocalizedCountryName(code, locale);
}
