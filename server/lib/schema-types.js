/**
 * schema-types.js: the schema.org types the business-label Check counts as a local business.
 *
 * How this list was made: by hand, from the schema.org type tree. LOCAL_BUSINESS_TYPE_LIST holds `LocalBusiness` and
 * every type that has `LocalBusiness` anywhere among its parents (a type with several parents counts when any parent
 * chain reaches `LocalBusiness`; `MedicalOrganization` is one, so `VeterinaryCare` and `DiagnosticLab` are in).
 * Source: https://schema.org/LocalBusiness, its "More specific Types" tree, and the pages of its children.
 * Release: written from the author's knowledge of the tree, not from a fetch; the release number and date were NOT
 * read from schema.org, and the code reviewer checks this list against the live schema.org tree. Record the release
 * and date here when that check is done.
 * Nothing is fetched while the site runs, and the Grader never refreshes this list. Odd members of the tree
 * (FireStation, Hospital, Library, PostOffice and the like) stay in on purpose; they are harmless.
 *
 * `OnlineBusiness` and `OnlineStore` are Organization types, not local businesses: they are in neither list below
 * and never count (V156). `CleaningService` (not a schema.org name) is added in page-facts.js.
 */

export const LOCAL_BUSINESS_TYPE_LIST = Object.freeze([
  'LocalBusiness',
  'AnimalShelter',
  'ArchiveOrganization',
  // AutomotiveBusiness
  'AutomotiveBusiness', 'AutoBodyShop', 'AutoDealer', 'AutoPartsStore', 'AutoRental', 'AutoRepair', 'AutoWash',
  'GasStation', 'MotorcycleDealer', 'MotorcycleRepair',
  'ChildCare',
  'DryCleaningOrLaundry',
  // EmergencyService
  'EmergencyService', 'FireStation', 'Hospital', 'PoliceStation',
  'EmploymentAgency',
  // EntertainmentBusiness
  'EntertainmentBusiness', 'AdultEntertainment', 'AmusementPark', 'ArtGallery', 'Casino', 'ComedyClub',
  'MovieTheater', 'NightClub',
  // FinancialService
  'FinancialService', 'AccountingService', 'AutomatedTeller', 'BankOrCreditUnion', 'InsuranceAgency',
  // FoodEstablishment
  'FoodEstablishment', 'Bakery', 'BarOrPub', 'Brewery', 'CafeOrCoffeeShop', 'Distillery', 'FastFoodRestaurant',
  'IceCreamShop', 'Restaurant', 'Winery',
  // GovernmentOffice
  'GovernmentOffice', 'PostOffice',
  // HealthAndBeautyBusiness
  'HealthAndBeautyBusiness', 'BeautySalon', 'DaySpa', 'HairSalon', 'HealthClub', 'NailSalon', 'TattooParlor',
  // HomeAndConstructionBusiness
  'HomeAndConstructionBusiness', 'Electrician', 'GeneralContractor', 'HVACBusiness', 'HousePainter', 'Locksmith',
  'MovingCompany', 'Plumber', 'RoofingContractor',
  'InternetCafe',
  // LegalService
  'LegalService', 'Attorney', 'Notary',
  'Library',
  // LodgingBusiness
  'LodgingBusiness', 'BedAndBreakfast', 'Campground', 'Hostel', 'Hotel', 'Motel', 'Resort', 'SkiResort',
  'VacationRental',
  // MedicalBusiness
  'MedicalBusiness', 'CommunityHealth', 'Dermatology', 'DietNutrition', 'Emergency', 'Geriatric', 'Gynecologic',
  'MedicalClinic', 'CovidTestingFacility', 'Midwifery', 'Nursing', 'Obstetric', 'Oncologic', 'Optician',
  'Optometric', 'Otolaryngologic', 'Pediatric', 'Pharmacy', 'Physician', 'IndividualPhysician', 'PhysiciansOffice',
  'Physiotherapy', 'PlasticSurgery', 'Podiatric', 'PrimaryCare', 'Psychiatric', 'PublicHealth',
  // MedicalOrganization (its parents are Organization and LocalBusiness)
  'MedicalOrganization', 'Dentist', 'DiagnosticLab', 'VeterinaryCare',
  'ProfessionalService',
  'RadioStation',
  'RealEstateAgent',
  'RecyclingCenter',
  'SelfStorage',
  'ShoppingCenter',
  // SportsActivityLocation
  'SportsActivityLocation', 'BowlingAlley', 'ExerciseGym', 'GolfCourse', 'PublicSwimmingPool', 'SportsClub',
  'StadiumOrArena', 'TennisComplex',
  // Store
  'Store', 'BikeStore', 'BookStore', 'ClothingStore', 'ComputerStore', 'ConvenienceStore', 'DepartmentStore',
  'ElectronicsStore', 'Florist', 'FurnitureStore', 'GardenStore', 'GroceryStore', 'HardwareStore', 'HobbyShop',
  'HomeGoodsStore', 'JewelryStore', 'LiquorStore', 'MensClothingStore', 'MobilePhoneStore', 'MovieRentalStore',
  'MusicStore', 'OfficeEquipmentStore', 'OutletStore', 'PawnShop', 'PetStore', 'ShoeStore', 'SportingGoodsStore',
  'TireShop', 'ToyStore', 'WholesaleStore',
  'TelevisionStation',
  'TouristInformationCenter',
  'TravelAgency',
]);

/** Every type of LOCAL_BUSINESS_TYPE_LIST, for lookups. */
export const LOCAL_BUSINESS_TYPES = Object.freeze(new Set(LOCAL_BUSINESS_TYPE_LIST));

/**
 * `Organization` and its subtypes that are not local businesses. Like `Organization`, they count as the business
 * only together with a telephone and an address. `OnlineBusiness` and `OnlineStore` are left out on purpose.
 */
export const ORGANIZATION_TYPES = Object.freeze(new Set([
  'Organization', 'Airline', 'Consortium', 'Corporation', 'EducationalOrganization', 'CollegeOrUniversity',
  'ElementarySchool', 'HighSchool', 'MiddleSchool', 'Preschool', 'School', 'FundingScheme',
  'GovernmentOrganization', 'LibrarySystem', 'NGO', 'NewsMediaOrganization', 'PerformingGroup', 'DanceGroup',
  'MusicGroup', 'TheaterGroup', 'PoliticalParty', 'Project', 'ResearchOrganization', 'SearchRescueOrganization',
  'SportsOrganization', 'SportsTeam', 'WorkersUnion',
]));
