# Review notes: page read of Features A, B, C and bot protection (Nov 22, 2026)

Written by Claude (reviewer), not by Kiro. Kiro makes the changes.
Read at commit e942626, phone (390px) and desktop (1280px). Verdict: READY. Nothing blocks.
The code review of V80, V81 and F7 was also READY.

These are small wording fixes. Change page text only, plus any test that quotes the old text.

## V82 Owner form: the left-out note uses jargon
Now: "We left that link out. It must be an https link to your reviews on Google, Yelp, Facebook or Nextdoor."
Change to: "We left that link out. It must start with https:// and go to your reviews on Google, Yelp, Facebook or Nextdoor."

## V83 Owner form: "Saved." at the top hides that the link was left out
When the reviews link is left out, the green line at the top says only "Saved." and the red note is far down the page.
Change the top line in that case to: "Saved, but we left out your reviews link. See below."

## V84 Owner form: "Street address" has no hint for a no-storefront owner
Add the hint: "Optional. Leave it blank if you go to your customers."

## V85 Per-address limit page: "address" misleads on a site about street addresses
Now: "We have had a lot of checks from your address."
Change to: "We have had a lot of checks from your internet connection."

## V86 Per-network limit page
Now: "A lot of checks have come from your network today."
Change to: "A lot of checks have come from your internet provider today. Please try again tomorrow, or from another connection."

## V87 Report: check names disagree
"Service area on your home page" sits beside "Hours on the home page" and "Street address on the home page".
Use "the home page" in all three.

## V88 To check, not wording
A test page labeled with the schema.org type `AutoWash` got "no business label found". `AutoWash` is a kind of LocalBusiness (under AutomotiveBusiness).
Check how the business-label Check decides which types count. If it uses a fixed list, say so in a note and list what is missing; do not change scoring without a requirement.

## Kiro findings

V82 to V87 are done as written: the left-out note, the "Saved, but…" top line, the street address hint, the two limit messages and the label "Service area on the home page". The tests that quoted the old text (`test/grade-guard.test.js`, `test/grade-no-storefront.test.js`, `test/listing-reviews-link.test.js`) were updated on those lines only.

V88 (no scoring change made): yes, it is a fixed list. `isBusinessNode` in `server/lib/page-facts.js` counts a JSON-LD node as the business when one of its `@type` values is in `BUSINESS_TYPES`, or when it is an `Organization` that has both a `telephone` and an `address`. The set holds 31 types: LocalBusiness, Restaurant, FoodEstablishment, CafeOrCoffeeShop, BarOrPub, Bakery, HomeAndConstructionBusiness, RoofingContractor, HVACBusiness, Plumber, Electrician, GeneralContractor, HousePainter, Locksmith, MovingCompany, AutomotiveBusiness, AutoRepair, HealthAndBeautyBusiness, HairSalon, BeautySalon, DaySpa, LegalService, Attorney, ProfessionalService, FinancialService, InsuranceAgency, RealEstateAgent, Dentist, MedicalBusiness, Store, CleaningService. A parent type in the list does not cover its children: `AutomotiveBusiness` is there, but `AutoWash` is not, so a page labeled only `AutoWash` gets "We found no readable business label". The same happens for every other schema.org subtype of LocalBusiness that is not listed. Missing ones that local businesses use often include:
- automotive: AutoWash, AutoBodyShop, AutoDealer, AutoPartsStore, AutoRental, GasStation, MotorcycleDealer, MotorcycleRepair;
- food and drink: FastFoodRestaurant, IceCreamShop, Brewery, Winery, Distillery;
- health and beauty: NailSalon, TattooParlor, HealthClub, Optician, Pharmacy, Physician, MedicalClinic, VeterinaryCare;
- services and places: AccountingService, AnimalShelter, ChildCare, DryCleaningOrLaundry, EmergencyService, EmploymentAgency, TravelAgency, SelfStorage, Notary, LodgingBusiness, Hotel, ShoppingCenter, EntertainmentBusiness, SportsActivityLocation, TouristInformationCenter, GovernmentOffice, Library, RadioStation;
- the many Store kinds: HardwareStore, FurnitureStore, ClothingStore, Florist, PetStore, BikeStore, BookStore, GroceryStore, ConvenienceStore, LiquorStore, JewelryStore, ShoeStore, ToyStore, and others.

The trade types under HomeAndConstructionBusiness are all already listed. Two ways to fix the rest, for whoever writes the requirement: list every schema.org descendant of LocalBusiness (well over a hundred names, kept in one file), or keep a small map from each subtype to its parent and count a type when any parent on its chain is listed. Either one changes scores for pages that use these types (the business-labeled Check is worth 8 points), so it needs a requirement and an entry in the design's "Numbers that change" table first.
