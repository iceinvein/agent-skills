<%@ Page Language="C#" AutoEventWireup="true" MasterPageFile="~/Site.master" CodeFile="Users.aspx.cs" Inherits="TinyWebForms.UsersPage" %>
<!-- Workflow step 2: lands here after signup, checks api/users/{id}/welcome. -->
<asp:Content ContentPlaceHolderID="MainContent" runat="server">
  <h1>Users</h1>
  <asp:Repeater ID="UsersList" runat="server">
    <ItemTemplate><%# Eval("Email") %></ItemTemplate>
  </asp:Repeater>
</asp:Content>
