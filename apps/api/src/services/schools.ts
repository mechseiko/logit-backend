import type { School } from '@logit/shared';
import type { Store } from '../db/index.js';

type SchoolSeed = [name: string, shortName: string, state: string, type: School['type'], aliases: string[]];

/** Seeded Nigerian institutions (universities, polytechnics, colleges of education). */
const SCHOOL_SEED: SchoolSeed[] = [
  ['University of Lagos', 'UNILAG', 'Lagos', 'university', ['Unilag', 'University of Lagos, Akoka']],
  ['University of Ibadan', 'UI', 'Oyo', 'university', ['UI Ibadan']],
  ['Obafemi Awolowo University', 'OAU', 'Osun', 'university', ['OAU Ife', 'Great Ife']],
  ['Ahmadu Bello University', 'ABU', 'Kaduna', 'university', ['ABU Zaria']],
  ['University of Nigeria, Nsukka', 'UNN', 'Enugu', 'university', ['UNN', 'Nsukka']],
  ['University of Benin', 'UNIBEN', 'Edo', 'university', ['Uniben']],
  ['University of Port Harcourt', 'UNIPORT', 'Rivers', 'university', ['Uniport']],
  ['University of Ilorin', 'UNILORIN', 'Kwara', 'university', ['Unilorin', 'Better by far']],
  ['University of Jos', 'UNIJOS', 'Plateau', 'university', ['Unijos']],
  ['University of Calabar', 'UNICAL', 'Cross River', 'university', ['Unical']],
  ['University of Uyo', 'UNIUYO', 'Akwa Ibom', 'university', ['Uniuyo']],
  ['University of Maiduguri', 'UNIMAID', 'Borno', 'university', ['Unimaid']],
  ['Bayero University Kano', 'BUK', 'Kano', 'university', ['BUK', 'Bayero']],
  ['University of Abuja', 'UNIABUJA', 'FCT', 'university', ['Uniabuja', 'Gwagwalada']],
  ['Federal University of Technology, Akure', 'FUTA', 'Ondo', 'university', ['FUTA Akure']],
  ['Federal University of Technology, Owerri', 'FUTO', 'Imo', 'university', ['FUTO Owerri']],
  ['Federal University of Technology, Minna', 'FUTMINNA', 'Niger', 'university', ['FUT Minna']],
  ['Federal University of Agriculture, Abeokuta', 'FUNAAB', 'Ogun', 'university', ['Funaab']],
  ['Federal University of Agriculture, Makurdi', 'FUAM', 'Benue', 'university', ['FUAM Makurdi']],
  ['Nnamdi Azikiwe University', 'UNIZIK', 'Anambra', 'university', ['Unizik', 'Awka']],
  ['Delta State University', 'DELSU', 'Delta', 'university', ['Delsu', 'Abraka']],
  ['Ekiti State University', 'EKSU', 'Ekiti', 'university', ['EKSU Ado Ekiti']],
  ['Olabisi Onabanjo University', 'OOU', 'Ogun', 'university', ['OOU Ago Iwoye']],
  ['Lagos State University', 'LASU', 'Lagos', 'university', ['Lasu', 'Ojo']],
  ['Rivers State University', 'RSU', 'Rivers', 'university', ['RSUST', 'Rivers State University of Science and Technology']],
  ['Ambrose Alli University', 'AAU', 'Edo', 'university', ['AAU Ekpoma']],
  ['Kogi State University', 'KSU', 'Kogi', 'university', ['Prince Abubakar Audu University', 'Anyigba']],
  ['Benue State University', 'BSU', 'Benue', 'university', ['BSU Makurdi']],
  ['Abia State University', 'ABSU', 'Abia', 'university', ['ABSU Uturu']],
  ['Imo State University', 'IMSU', 'Imo', 'university', ['IMSU Owerri']],
  ['Chukwuemeka Odumegwu Ojukwu University', 'COOU', 'Anambra', 'university', ['ANSU', 'Anambra State University']],
  ['Enugu State University of Science and Technology', 'ESUT', 'Enugu', 'university', ['ESUT']],
  ['Michael Okpara University of Agriculture, Umudike', 'MOUAU', 'Abia', 'university', ['MOUAU', 'Umudike']],
  ['Federal University, Oye-Ekiti', 'FUOYE', 'Ekiti', 'university', ['FUOYE']],
  ['Federal University, Lokoja', 'FULOKOJA', 'Kogi', 'university', ['FUL']],
  ['Federal University, Lafia', 'FULAFIA', 'Nasarawa', 'university', ['FULafia']],
  ['Federal University, Kashere', 'FUKASHERE', 'Gombe', 'university', ['FUK']],
  ['Federal University, Dutse', 'FUDUTSE', 'Jigawa', 'university', ['FUD']],
  ['Federal University, Wukari', 'FUWUKARI', 'Taraba', 'university', ['FUW']],
  ['Federal University, Birnin Kebbi', 'FUBK', 'Kebbi', 'university', ['FUBK']],
  ['Federal University, Gusau', 'FUGUS', 'Zamfara', 'university', ['FUGUS']],
  ['Federal University, Gashua', 'FUGASHUA', 'Yobe', 'university', ['FUGashua']],
  ['Federal University of Petroleum Resources, Effurun', 'FUPRE', 'Delta', 'university', ['FUPRE']],
  ['Nigerian Defence Academy', 'NDA', 'Kaduna', 'university', ['NDA Kaduna']],
  ['Adekunle Ajasin University', 'AAUA', 'Ondo', 'university', ['AAUA Akungba']],
  ['Tai Solarin University of Education', 'TASUED', 'Ogun', 'university', ['TASUED Ijagun']],
  ['Osun State University', 'UNIOSUN', 'Osun', 'university', ['Uniosun', 'Osogbo']],
  ['Kwara State University', 'KWASU', 'Kwara', 'university', ['KWASU Malete']],
  ['Ibrahim Badamasi Babangida University', 'IBBU', 'Niger', 'university', ['IBBU Lapai']],
  ["Umaru Musa Yar'adua University", 'UMYU', 'Katsina', 'university', ['UMYU']],
  ['Sokoto State University', 'SSU', 'Sokoto', 'university', ['SSU Sokoto']],
  ['Gombe State University', 'GSU', 'Gombe', 'university', ['GSU Gombe']],
  ['Adamawa State University', 'ADSU', 'Adamawa', 'university', ['ADSU Mubi']],
  ['Taraba State University', 'TSU', 'Taraba', 'university', ['TSU Jalingo']],
  ['Nasarawa State University, Keffi', 'NSUK', 'Nasarawa', 'university', ['NSUK']],
  ['Kaduna State University', 'KASU', 'Kaduna', 'university', ['KASU']],
  ['Sule Lamido University', 'SLU', 'Jigawa', 'university', ['SLU Kafin Hausa']],
  ['Yusuf Maitama Sule University', 'YUMSUK', 'Kano', 'university', ['Yusuf Maitama Sule University Kano']],
  ['Aliko Dangote University of Science and Technology', 'ADUSTECH', 'Kano', 'university', ['Kano University of Science and Technology', 'KUST', 'Wudil']],
  ['Covenant University', 'CU', 'Ogun', 'university', ['Covenant Ota']],
  ['Babcock University', 'BU', 'Ogun', 'university', ['Babcock Ilishan']],
  ['Bowen University', 'BOWEN', 'Osun', 'university', ['Bowen Iwo']],
  ["Redeemer's University", 'RUN', 'Osun', 'university', ['Redeemers University Ede']],
  ['Ajayi Crowther University', 'ACU', 'Oyo', 'university', ['ACU Oyo']],
  ['Bells University of Technology', 'BELLS', 'Ogun', 'university', ['Bells Ota']],
  ['Lead City University', 'LCU', 'Oyo', 'university', ['Lead City Ibadan']],
  ['Caleb University', 'CALEB', 'Lagos', 'university', ['Caleb Imota']],
  ['Afe Babalola University', 'ABUAD', 'Ekiti', 'university', ['ABUAD Ado Ekiti']],
  ['American University of Nigeria', 'AUN', 'Adamawa', 'university', ['AUN Yola']],
  ['Igbinedion University', 'IUO', 'Edo', 'university', ['Igbinedion Okada']],
  ['Madonna University', 'MADONNA', 'Anambra', 'university', ['Madonna Okija']],
  ['Veritas University', 'VERITAS', 'FCT', 'university', ['Veritas Abuja']],
  ['Nile University of Nigeria', 'NILE', 'FCT', 'university', ['Nile Abuja']],
  ['Baze University', 'BAZE', 'FCT', 'university', ['Baze Abuja']],
  ['Elizade University', 'ELIZADE', 'Ondo', 'university', ['Elizade Ilara Mokin']],
  ['Achievers University', 'ACHIEVERS', 'Ondo', 'university', ['Achievers Owo']],
  ['Novena University', 'NOVENA', 'Delta', 'university', ['Novena Ogume']],
  ['Samuel Adegboyega University', 'SAU', 'Edo', 'university', ['SAU Ogwa']],
  ['Wellspring University', 'WELLSPRING', 'Edo', 'university', ['Wellspring Benin']],
  ['Fountain University', 'FUO', 'Osun', 'university', ['Fountain Osogbo']],
  ['Al-Hikmah University', 'AL-HIKMAH', 'Kwara', 'university', ['Al Hikmah Ilorin']],
  ['Al-Qalam University', 'ALU', 'Katsina', 'university', ['Al Qalam Katsina']],
  ['University of Medical Sciences, Ondo', 'UNIMED', 'Ondo', 'university', ['UNIMED Ondo']],
  ['Edo University, Iyamho', 'EUI', 'Edo', 'university', ['Edo University']],
  ['Western Delta University', 'WDU', 'Delta', 'university', ['WDU Oghara']],
  ['Paul University', 'PAUL', 'Anambra', 'university', ['Paul University Awka']],
  ['Caritas University', 'CARITAS', 'Enugu', 'university', ['Caritas Amorji Nike']],
  ['Godfrey Okoye University', 'GOUNI', 'Enugu', 'university', ['GO University']],
  ['Coal City University', 'CCU', 'Enugu', 'university', ['Coal City Enugu']],
  ['Spiritan University', 'SPIRITAN', 'Abia', 'university', ['Spiritan Nneochi']],
  ['Yaba College of Technology', 'YABATECH', 'Lagos', 'polytechnic', ['Yabatech', 'Yaba Tech']],
  ['Kaduna Polytechnic', 'KADPOLY', 'Kaduna', 'polytechnic', ['Kadpoly']],
  ['Auchi Polytechnic', 'AUCHI POLY', 'Edo', 'polytechnic', ['Auchi Poly']],
  ['The Polytechnic, Ibadan', 'POLY IBADAN', 'Oyo', 'polytechnic', ['Ibadan Poly', 'Poly Ibadan']],
  ['Federal Polytechnic, Nekede', 'FPNEKEDE', 'Imo', 'polytechnic', ['Nekede Poly', 'Federal Poly Nekede']],
  ['Federal Polytechnic, Ilaro', 'FPILARO', 'Ogun', 'polytechnic', ['Ilaro Poly']],
  ['Federal Polytechnic, Bida', 'FPBIDA', 'Niger', 'polytechnic', ['Bida Poly']],
  ['Federal Polytechnic, Bauchi', 'FPBAUCHI', 'Bauchi', 'polytechnic', ['Bauchi Poly']],
  ['Federal Polytechnic, Ede', 'FPEDE', 'Osun', 'polytechnic', ['Ede Poly']],
  ['Federal Polytechnic, Ado-Ekiti', 'FPADO', 'Ekiti', 'polytechnic', ['Ado Poly']],
  ['Federal Polytechnic, Offa', 'FPOFFA', 'Kwara', 'polytechnic', ['Offa Poly']],
  ['Federal Polytechnic, Owerri', 'FPOWERRI', 'Imo', 'polytechnic', ['Owerri Poly']],
  ['Federal Polytechnic, Oko', 'FPOKO', 'Anambra', 'polytechnic', ['Oko Poly']],
  ['Federal Polytechnic, Nasarawa', 'FPNASARAWA', 'Nasarawa', 'polytechnic', ['Nasarawa Poly']],
  ['Federal Polytechnic, Damaturu', 'FPDAMATURU', 'Yobe', 'polytechnic', ['Damaturu Poly']],
  ['Federal Polytechnic, Kaura Namoda', 'FPKNAMODA', 'Zamfara', 'polytechnic', ['Kaura Namoda Poly']],
  ['Federal Polytechnic, Mubi', 'FPMUBI', 'Adamawa', 'polytechnic', ['Mubi Poly']],
  ['Federal Polytechnic, Idah', 'FPIDAH', 'Kogi', 'polytechnic', ['Idah Poly']],
  ['Federal Polytechnic, Ekowe', 'FPEKOWE', 'Bayelsa', 'polytechnic', ['Ekowe Poly']],
  ['Federal Polytechnic, Ukana', 'FPUKANA', 'Akwa Ibom', 'polytechnic', ['Ukana Poly']],
  ['Federal Polytechnic, Ile-Oluji', 'FPILEOLUJI', 'Ondo', 'polytechnic', ['Ile Oluji Poly']],
  ['Federal Polytechnic, Ayede', 'FPAYEDE', 'Oyo', 'polytechnic', ['Ayede Poly']],
  ['Lagos State Polytechnic', 'LASPOTECH', 'Lagos', 'polytechnic', ['Laspo', 'Ikorodu Poly']],
  ['Moshood Abiola Polytechnic', 'MAPOLY', 'Ogun', 'polytechnic', ['Mapoly', 'Abeokuta Poly']],
  ['Osun State Polytechnic', 'OSPOLY', 'Osun', 'polytechnic', ['Iree Poly']],
  ['Rufus Giwa Polytechnic', 'RUGIPO', 'Ondo', 'polytechnic', ['Rugipo', 'Owo Poly']],
  ['Delta State Polytechnic, Ogwashi-Uku', 'DSPOGWASHI', 'Delta', 'polytechnic', ['Ogwashi Poly']],
  ['Delta State Polytechnic, Otefe-Oghara', 'DSPOTEFE', 'Delta', 'polytechnic', ['Otefe Oghara Poly']],
  ['Delta State Polytechnic, Ozoro', 'DSPOZORO', 'Delta', 'polytechnic', ['Ozoro Poly']],
  ['Ken Saro-Wiwa Polytechnic', 'KENPOLY', 'Rivers', 'polytechnic', ['Kenpoly', 'Bori Poly']],
  ['Port Harcourt Polytechnic', 'PHCITYPOLY', 'Rivers', 'polytechnic', ['Port Harcourt Poly']],
  ['Gateway Polytechnic', 'GAPOSA', 'Ogun', 'polytechnic', ['Gateway Saapade']],
  ['Abraham Adesanya Polytechnic', 'AAPOLY', 'Ogun', 'polytechnic', ['Aapoly Ijebu Igbo']],
  ['Ogun State Institute of Technology', 'OGITECH', 'Ogun', 'polytechnic', ['Ogitech Igbesa']],
  ['Institute of Management and Technology', 'IMT', 'Enugu', 'polytechnic', ['IMT Enugu']],
  ['Abia State Polytechnic', 'ABIAPOLY', 'Abia', 'polytechnic', ['Abia Poly Aba']],
  ['Imo State Polytechnic', 'IMOPOLY', 'Imo', 'polytechnic', ['Imopoly Umuagwo']],
  ['Kano State Polytechnic', 'KANOPOLY', 'Kano', 'polytechnic', ['Kano Poly']],
  ['Hassan Usman Katsina Polytechnic', 'HUKPOLY', 'Katsina', 'polytechnic', ['Katsina Poly']],
  ['Sokoto State Polytechnic', 'SOKPOLY', 'Sokoto', 'polytechnic', ['Sokoto Poly']],
  ['Umaru Ali Shinkafi Polytechnic', 'UASPOLY', 'Sokoto', 'polytechnic', ['Shinkafi Poly']],
  ['Ramat Polytechnic', 'RAMATPOLY', 'Borno', 'polytechnic', ['Ramat Maiduguri']],
  ['Waziri Umaru Federal Polytechnic', 'WUFEDPOLY', 'Kebbi', 'polytechnic', ['Waziri Umaru Birnin Kebbi']],
  ['Adamawa State Polytechnic', 'ADAMAWAPOLY', 'Adamawa', 'polytechnic', ['Adamawa Poly Yola']],
  ['Benue State Polytechnic', 'BENPOLY', 'Benue', 'polytechnic', ['Benpoly Ugbokolo']],
  ['Plateau State Polytechnic', 'PLAPOLY', 'Plateau', 'polytechnic', ['Plateau Poly Barkin Ladi']],
  ['Nuhu Bamalli Polytechnic', 'NUBAPOLY', 'Kaduna', 'polytechnic', ['Nubapoly Zaria']],
  ['Hussaini Adamu Federal Polytechnic', 'HAFPOLY', 'Jigawa', 'polytechnic', ['Hafpoly Kazaure']],
  ['Jigawa State Polytechnic', 'JIGPOLY', 'Jigawa', 'polytechnic', ['Jigpoly Dutse']],
  ['Federal Polytechnic, Bali', 'FPBALI', 'Taraba', 'polytechnic', ['Bali Poly']],
  ['Niger State Polytechnic', 'NIGERPOLY', 'Niger', 'polytechnic', ['Niger Poly Zungeru']],
  ['Kwara State Polytechnic', 'KWARAPOLY', 'Kwara', 'polytechnic', ['Kwara Poly Ilorin']],
  ['Kogi State Polytechnic', 'KOGIPOLY', 'Kogi', 'polytechnic', ['Kogi Poly Lokoja']],
  ['Edo State Polytechnic', 'EDOPOLY', 'Edo', 'polytechnic', ['Edo Poly Usen']],
  ['Akanu Ibiam Federal Polytechnic', 'AKANUIBIAM', 'Ebonyi', 'polytechnic', ['Akanu Ibiam Unwana']],
  ['Federal College of Education (Technical), Akoka', 'FCETAKOKA', 'Lagos', 'college', ['FCET Akoka']],
  ['Federal College of Education, Zaria', 'FCEZARIA', 'Kaduna', 'college', ['FCE Zaria']],
  ['Federal College of Education, Kano', 'FCEKANO', 'Kano', 'college', ['FCE Kano']],
  ['Federal College of Education, Okene', 'FCEOKENE', 'Kogi', 'college', ['FCE Okene']],
  ['Federal College of Education, Abeokuta', 'FCEABEOKUTA', 'Ogun', 'college', ['FCE Abeokuta']],
  ['Federal College of Education, Eha-Amufu', 'FCEEHAAMUFU', 'Enugu', 'college', ['FCE Eha Amufu']],
  ['Federal College of Education, Pankshin', 'FCEPANKSHIN', 'Plateau', 'college', ['FCE Pankshin']],
  ['Federal College of Education, Obudu', 'FCEOBUDU', 'Cross River', 'college', ['FCE Obudu']],
  ['Federal College of Education, Oyo', 'FCEOYO', 'Oyo', 'college', ['FCE Oyo']],
  ['Federal College of Education, Kontagora', 'FCEKONTAGORA', 'Niger', 'college', ['FCE Kontagora']],
  ['Federal College of Education, Gombe', 'FCEGOMBE', 'Gombe', 'college', ['FCE Gombe']],
  ['Federal College of Education, Yola', 'FCEYOLA', 'Adamawa', 'college', ['FCE Yola']],
  ['Federal College of Education, Umunze', 'FCEUMUNZE', 'Anambra', 'college', ['FCE Umunze']],
  ['Federal College of Education, Katsina', 'FCEKATSINA', 'Katsina', 'college', ['FCE Katsina']],
  ['Kwara State College of Education, Ilorin', 'KWCOEILORIN', 'Kwara', 'college', ['Kwara COE']],
  ['College of Education, Warri', 'COEWARRI', 'Delta', 'college', ['COE Warri']],
  ['College of Education, Agbor', 'COEAGBOR', 'Delta', 'college', ['COE Agbor']],
  ['Tai Solarin College of Education', 'TASCE', 'Ogun', 'college', ['TASCE Omu Ijebu']],
  ['Osun State College of Education, Ila-Orangun', 'OSCOED', 'Osun', 'college', ['OSCOED']],
  ['Adeniran Ogunsanya College of Education', 'AOCOED', 'Lagos', 'college', ['AOCOED Ijanikin']],
  ['Michael Otedola College of Primary Education', 'MOCPED', 'Lagos', 'college', ['MOCPED Noforija']],
  ['Nwafor Orizu College of Education', 'NOCEN', 'Anambra', 'college', ['NOCEN Nsugbe']],
  ['Enugu State College of Education (Technical)', 'ESCET', 'Enugu', 'college', ['ESCET']],
  ['Abia State College of Education (Technical)', 'ASCETA', 'Abia', 'college', ['ASCETA Arochukwu']],
  ['College of Education, Ikere-Ekiti', 'COEIKERE', 'Ekiti', 'college', ['COE Ikere']],
  ['College of Education, Oro', 'COEORO', 'Kwara', 'college', ['COE Oro']],
  ['Emmanuel Alayande College of Education', 'EACOED', 'Oyo', 'college', ['EACOED Oyo']],
  ['Shehu Shagari College of Education', 'SSCOE', 'Sokoto', 'college', ['SSCOE Sokoto']],
  ['College of Education, Azare', 'COEAZARE', 'Bauchi', 'college', ['COE Azare']],
  ['Aminu Saleh College of Education', 'ASCOE', 'Yobe', 'college', ['ASCOE Azare']],
  ['Kashim Ibrahim College of Education', 'KICOE', 'Borno', 'college', ['KICOE Maiduguri']],
  ['Isa Kaita College of Education', 'IKCOE', 'Katsina', 'college', ['IKCOE Dutsinma']],
  ['Federal College of Education (Technical), Bichi', 'FCETBICHI', 'Kano', 'college', ['FCET Bichi']],
  ['Federal College of Education (Technical), Potiskum', 'FCETPOTISKUM', 'Yobe', 'college', ['FCET Potiskum']],
  ['Federal College of Education (Technical), Omoku', 'FCETOMOKU', 'Rivers', 'college', ['FCET Omoku']],
  ['Federal College of Education (Technical), Isu', 'FCETISU', 'Ebonyi', 'college', ['FCET Isu']],
];

export function schoolIdFromShortName(shortName: string): string {
  return shortName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function ensureSchoolSeed(store: Store): Promise<number> {
  const existing = await store.count('schools');
  if (existing >= SCHOOL_SEED.length) return 0;
  let created = 0;
  for (const [name, shortName, state, type, aliases] of SCHOOL_SEED) {
    const id = schoolIdFromShortName(shortName);
    const current = await store.get<School>(`schools/${id}`);
    if (current) continue;
    const school: School = { id, name, shortName, state, type, aliases, active: true };
    await store.set(`schools/${id}`, school);
    created += 1;
  }
  return created;
}

export function schoolSearchText(school: School): string {
  return [school.name, school.shortName, school.state, ...school.aliases].join(' ').toLowerCase();
}

export async function searchSchools(store: Store, query: string, limit = 20): Promise<School[]> {
  const schools = await store.query<School>('schools', { where: [['active', '==', true]] });
  const q = query.trim().toLowerCase();
  const ranked = schools
    .map((school) => {
      const haystack = schoolSearchText(school);
      let score = 0;
      if (!q) score = 1;
      else if (school.shortName.toLowerCase() === q || school.name.toLowerCase() === q) score = 100;
      else if (school.shortName.toLowerCase().startsWith(q)) score = 80;
      else if (school.name.toLowerCase().startsWith(q)) score = 70;
      else if (haystack.includes(q)) score = 40;
      return { school, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.school.name.localeCompare(b.school.name));
  return ranked.slice(0, limit).map((entry) => entry.school);
}

export async function getSchool(store: Store, id: string): Promise<School | null> {
  return store.get<School>(`schools/${id}`);
}

export async function listSchools(store: Store): Promise<School[]> {
  const schools = await store.query<School>('schools', {});
  return schools.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createOrUpdateSchool(
  store: Store,
  input: Omit<School, 'id'>,
  id?: string,
): Promise<School> {
  const schoolId = id ?? schoolIdFromShortName(input.shortName);
  const school: School = { ...input, id: schoolId };
  await store.set(`schools/${schoolId}`, school);
  return school;
}

export const SCHOOL_SEED_COUNT = SCHOOL_SEED.length;
