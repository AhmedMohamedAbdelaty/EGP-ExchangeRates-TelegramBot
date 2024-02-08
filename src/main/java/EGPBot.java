import java.util.Timer;
import java.util.TimerTask;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.telegram.telegrambots.bots.TelegramLongPollingBot;
import org.telegram.telegrambots.meta.api.methods.send.SendMessage;
import org.telegram.telegrambots.meta.api.methods.updates.SetWebhook;
import org.telegram.telegrambots.meta.api.objects.Update;
import org.telegram.telegrambots.meta.exceptions.TelegramApiException;
@SuppressWarnings("deprecation")
public class EGPBot extends TelegramLongPollingBot {

    @Override
    public String getBotUsername()
    {
        return System.getenv("EGP_BOT_USERNAME");
    }

    @Override
    public String getBotToken()
    {
        return System.getenv("EGP_BOT_TOKEN");
    }

    @Override
    public void onUpdateReceived(Update update)
    {
        if (update.hasMessage()) {
            long chatId = update.getMessage().getChatId();

            SendMessage message = new SendMessage();
            message.setChatId(String.valueOf(chatId));

            try {
                Document doc = Jsoup.connect("https://xrate.me/en/currency/egp/black").get();
                Element tr = doc.select("tr[data-href='/en/currency/usd-to-egp/black']").first();
                if (tr != null) {
                    Elements tds = tr.select("td.text-success");
                    Elements tdd = tr.select("td.text-danger");
                    if (tds.size() >= 2) {
                        String firstPrice = tds.get(0).text();
                        String lastPrice = tds.get(tds.size() - 1).text();
                        message.setText("The EGP exchange rate in the black market is:\n"
                            + "(Buy) " + firstPrice + "\n"
                            + "(Sell) " + lastPrice);
                    } else if (tdd.size() >= 2) {
                        String firstPrice = tdd.get(0).text();
                        String lastPrice = tdd.get(tdd.size() - 1).text();
                        message.setText("The EGP exchange rate in the black market is:\n"
                            + "(Buy) " + firstPrice + "\n"
                            + "(Sell) " + lastPrice);
                    } else {
                        message.setText("Sorry, I could not find the exchange rate from the website.");
                    }
                } else {
                    message.setText("Sorry, I could not find the exchange rate from the website.");
                }
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
    public void startKeepAlive()
    {
        Timer timer = new Timer();
        TimerTask task = new TimerTask() {
            @Override
            public void run()
            {
                try {
                    // Send a dummy request to keep the deployment active
                    execute(new SetWebhook());
                } catch (TelegramApiException e) {
                    e.printStackTrace();
                }
            }
        };

        // Schedule the task to run every 4 minutes (less than the 5-minute inactivity limit)
        timer.schedule(task, 0, 4 * 60 * 1000);
    }
}
