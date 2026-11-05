
export const projectSymbols = ["projectAirplaneTilt", "projectBalloon", "projectAtom", "projectAsterisk", "projectBaby", "projectBed", "projectBeachBall", "projectBird", "projectButterfly", "projectCat", "projectDog", "projectFish", "projectRabbit", "projectHorse", "projectPawPrint", "projectCactus", "projectClover", "projectFlower", "projectFlowerLotus", "projectLeaf", "projectPlant", "projectTree", "projectTreeEvergreen", "projectAcorn", "projectCarrot", "projectOrange", "projectCoffee", "projectIceCream", "projectPizza", "projectBowlSteam", "projectCookie", "projectBread", "projectGuitar", "projectPianoKeys", "projectMicrophoneStage", "projectMusicNote", "projectCoin", "projectCowboyHat", "projectHeart", "projectHandHeart", "projectLightning", "projectFireSimple", "projectMagnet", "projectLog", "projectMoneyWavy", "projectCar", "projectBicycle", "projectBoat", "projectTrain", "projectTruck", "projectRocket", "projectSkull", "projectDiamond", "projectTire", "projectTrafficCone", "projectSpade", "projectClub", "projectHeartStraight"] as const;
export const projectColors = ["red", "orange", "yellow", "green", "aqua", "blue", "purple"] as const;

/** Stable name-based defaults; independent hashes keep shapes and colors varied. */
export function projectIdentity(name: string) {
  const hash = (salt: string) => {
    let value = 2166136261;
    for (const character of salt + name.trim().normalize("NFC").toLocaleLowerCase("en-US")) { value = Math.imul(value ^ character.charCodeAt(0), 16777619); }
    return value >>> 0;
  };
  return { icon: projectSymbols[hash("shape:") % projectSymbols.length], color: projectColors[hash("color:") % projectColors.length] };
}

/** Choose creation defaults once per new-project visit, independent of its name. */
export function randomProjectIdentity() {
  return {
    icon: projectSymbols[Math.floor(Math.random() * projectSymbols.length)],
    color: projectColors[Math.floor(Math.random() * projectColors.length)],
  };
}
