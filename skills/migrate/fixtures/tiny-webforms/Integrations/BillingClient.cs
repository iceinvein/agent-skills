using System.Net.Http;

namespace TinyWebForms.Integrations
{
  // Notifies the external billing system once a signed-up user is activated.
  public class BillingClient
  {
    private readonly HttpClient _client = new HttpClient();

    public void NotifyActivation(long userId)
    {
      var body = new StringContent("{\"userId\":" + userId + "}");
      _client.PostAsync("https://billing.example.com/activations", body).Wait();
    }
  }
}
