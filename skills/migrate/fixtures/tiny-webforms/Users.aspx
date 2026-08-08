<%@ Page Language="C#" AutoEventWireup="true" %>
<!-- Workflow step 2: lands here after signup, checks api/users/{id}/welcome. -->
<!DOCTYPE html>
<html>
<head><title>Users</title></head>
<body>
  <h1>Users</h1>
  <asp:Repeater ID="UsersList" runat="server">
    <ItemTemplate><%# Eval("Email") %></ItemTemplate>
  </asp:Repeater>
</body>
</html>
