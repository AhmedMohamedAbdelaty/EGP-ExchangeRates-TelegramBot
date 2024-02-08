import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.telegram.telegrambots.bots.TelegramLongPollingBot;
import org.telegram.telegrambots.meta.api.methods.send.SendMessage;
import org.telegram.telegrambots.meta.api.objects.Update;
import org.telegram.telegrambots.meta.exceptions.TelegramApiException;

@SuppressWarnings("deprecation")
public class EGPBot extends TelegramLongPollingBot {

    @Override
    public String getBotUsername() {
        return "EGP_Exchange_Bot";
    }

    @Override
    public String getBotToken() {
        return "6927456802:AAF3qArY2h2zkieh0ietk8uB_gSGuBWayBE";
    }

    @Override
    public void onUpdateReceived(Update update) {
        if (update.hasMessage()) {
            long chatId = update.getMessage().getChatId();

            SendMessage message = new SendMessage();
            message.setChatId(String.valueOf(chatId));

            try {
                Document doc = Jsoup.connect("https://xrate.me/en/currency/egp/black").get();
                Element price = doc.select(".text-danger").first();
                String priceText = price.text();
                message.setText("The EGP exchange rate in the black market is: " + priceText);
            } catch (Exception e) {
                e.printStackTrace();
                message.setText("Sorry, I could not scrape the price from the website.");
            }

            try {
                execute(message);
            } catch (TelegramApiException e) {
                e.printStackTrace();
            }
        }
    }
}
