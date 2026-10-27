import { Keyboard, InlineKeyboard } from "../deps.deno.ts";

export function getMainMenuKeyboard(): Keyboard {
    return new Keyboard()
        .text("ملخص لجميع العملات 📈💰")
        .text("🌟 أسعار العملات المفضلة")
        .text("سعر عملة محددة 💱")
        .row()
        .text("🏅 أسعار الذهب")
        .text("⛽ أسعار الوقود")
        .row()
        .text("تحويل العملات 🔄")
        .text("معلومات ℹ️")
        .resized()
        .oneTime();
}

export function getCurrencySummaryKeyboard(): Keyboard {
    return new Keyboard()
        .text("💵 أسعار العملات في البنك")
        .row()
        .text("💰 أسعار السوق")
        .row()
        .text("🔙 العودة إلى القائمة الرئيسية")
        .resized();
}

export function getCurrencySelectionKeyboard(currencies: string[], callbackPrefix: string): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    currencies.forEach((currency, index) => {
        keyboard.text(currency, `${callbackPrefix}${currency.toUpperCase()}`);
        if ((index + 1) % 3 === 0) { // Add a new row every 3 currencies
            keyboard.row();
        }
    });
    keyboard.row();
    keyboard.text("🔙 العودة إلى القائمة الرئيسية", "main_menu_callback");
    return keyboard;
}

export function getCurrencyConversionKeyboard(): Keyboard {
    return new Keyboard()
        .text(`من الجنية إلي عملة أخرى`)
        .row()
        .text(`من عملة أخرى إلي الجنية`)
        .row()
        .text("🔙 العودة إلى القائمة الرئيسية")
        .resized();
}

export function getBackToMainMenuKeyboard(): Keyboard {
    return new Keyboard()
        .text("🔙 العودة إلى القائمة الرئيسية")
        .resized();
}
