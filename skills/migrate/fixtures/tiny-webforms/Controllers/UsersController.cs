using System;
using System.Configuration;
using System.Data.SqlClient;
using System.Web;
using System.Web.Http;
using TinyWebForms.Integrations;

namespace TinyWebForms.Controllers
{
  [RoutePrefix("api/users")]
  public class UsersController : ApiController
  {
    private readonly BillingClient _billing = new BillingClient();

    private SqlConnection OpenConnection()
    {
      var connStr = ConfigurationManager.ConnectionStrings["DefaultConnection"].ConnectionString;
      var conn = new SqlConnection(connStr);
      conn.Open();
      return conn;
    }

    [HttpGet, Route("")]
    public IHttpActionResult GetUsers()
    {
      using (var conn = OpenConnection())
      {
        var cmd = new SqlCommand("SELECT Id, Email FROM Users WHERE IsActive = 1", conn);
        return Ok(cmd.ExecuteReader());
      }
    }

    [HttpPost, Route("")]
    public IHttpActionResult CreateUser(UserSignupRequest request)
    {
      using (var conn = OpenConnection())
      {
        var cmd = new SqlCommand("INSERT INTO Users (Email, IsActive) VALUES (@email, 1)", conn);
        cmd.Parameters.AddWithValue("@email", request.Email);
        cmd.ExecuteNonQuery();
      }
      var id = DateTime.UtcNow.Ticks;
      HttpContext.Current.Session["PendingWelcome_" + id] = request.Email;
      return Ok(new { id });
    }

    [HttpGet, Route("{id}/welcome")]
    public IHttpActionResult GetWelcomeStatus(long id)
    {
      var email = HttpContext.Current.Session["PendingWelcome_" + id] as string;
      var enabled = ConfigurationManager.AppSettings["WelcomeEmailEnabled"];
      if (enabled == "true" && email != null) _billing.NotifyActivation(id);
      return Ok(new { sent = email != null });
    }
  }

  public class UserSignupRequest
  {
    public string Email { get; set; }
  }
}
