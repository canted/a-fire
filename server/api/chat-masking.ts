import { randomInt } from "node:crypto"

const ALIAS_COLORS = ["Amber", "Blue", "Coral", "Gold", "Green", "Indigo", "Pink", "Red", "Silver", "Violet"]
const ALIAS_ANIMALS = ["Badger", "Bear", "Crane", "Dolphin", "Fox", "Hare", "Otter", "Panda", "Raven", "Tiger"]

export function generateChatMaskedAlias() {
  return `${ALIAS_COLORS[randomInt(ALIAS_COLORS.length)]} ${ALIAS_ANIMALS[randomInt(ALIAS_ANIMALS.length)]}`
}
