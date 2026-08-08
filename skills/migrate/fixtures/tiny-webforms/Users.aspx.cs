using System;
using TinyWebForms.Controllers;

namespace TinyWebForms
{
  public partial class UsersPage : System.Web.UI.Page
  {
    protected void Page_Load(object sender, EventArgs e)
    {
      var id = long.Parse(Request.QueryString["id"] ?? "0");
      new UsersController().GetWelcomeStatus(id);
    }
  }
}
