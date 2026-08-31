// Shared design tokens for category theming — mirrors android's
// ui/theme/Color.kt (CategoryAccents) and CategoryIcons.kt exactly (same hex
// values, same icon-per-category mapping) so both platforms look identical.

export const CATEGORY_ACCENTS = {
  coro: "#2e7d4f",
  ipft: "#e8912d",
  ret: "#3b5fa6",
  course_cadre: "#7c4dbe",
  jolshiri: "#2e9c9c",
  misc: "#a0522d",
  fin_banking: "#4a4a8f",
  certificates: "#c9971f",
  resale_item_voucher: "#c0392b",
  tada_bill: "#546e7a",
  salary_adjustment: "#ad1457",
  yrly_diff_fees: "#00acc1",
  driving_license_docu: "#6d4c41",
  imp_med_docu: "#43a047",
  imp_cards: "#1e88e5",
  parents_docus: "#8d6e63",
  spouse_docus: "#ec407a",
  updt_bafz_2043: "#fb8c00",
  updt_bio_data: "#7cb342",
};

export const EMOJI_BY_CATEGORY_KEY = {
  coro: "📋",
  ipft: "💪",
  ret: "🎖️",
  course_cadre: "🎓",
  jolshiri: "🏠",
  misc: "🗂️",
  fin_banking: "🏦",
  certificates: "🏅",
  resale_item_voucher: "🧾",
  tada_bill: "🧳",
  salary_adjustment: "💳",
  yrly_diff_fees: "💰",
  driving_license_docu: "🚗",
  imp_med_docu: "🏥",
  imp_cards: "🪪",
  parents_docus: "👨‍👩‍👦",
  spouse_docus: "💞",
  updt_bafz_2043: "📄",
  updt_bio_data: "🪪",
};

export function categoryAccent(key) {
  return CATEGORY_ACCENTS[key] ?? "#2d6a4f";
}

export function categoryEmoji(key) {
  return EMOJI_BY_CATEGORY_KEY[key] ?? "📁";
}
