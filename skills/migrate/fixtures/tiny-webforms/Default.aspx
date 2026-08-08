<%@ Page Language="C#" AutoEventWireup="true" %>
<!-- Workflow step 1: signup screen, posts toward POST api/users, hands off to Users.aspx. -->
<!DOCTYPE html>
<html>
<head><title>Sign up</title></head>
<body>
  <form runat="server">
    <h1>Sign up</h1>
    <asp:TextBox ID="EmailBox" runat="server" />
    <asp:Button ID="SignupButton" runat="server" Text="Sign up" PostBackUrl="~/Users.aspx" />
  </form>
</body>
</html>
