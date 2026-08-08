using System;
using TinyWebForms.Controllers;

namespace TinyWebForms
{
  public partial class DefaultPage : System.Web.UI.Page
  {
    protected void SignupButton_Click(object sender, EventArgs e)
    {
      new UsersController().CreateUser(new UserSignupRequest { Email = EmailBox.Text });
      Response.Redirect("~/Users.aspx");
    }
  }
}
