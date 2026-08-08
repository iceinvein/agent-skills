<%@ Page Language="C#" AutoEventWireup="true" MasterPageFile="~/Site.master" CodeFile="Default.aspx.cs" Inherits="TinyWebForms.DefaultPage" %>
<!-- Workflow step 1: signup screen, posts toward POST api/users, hands off to Users.aspx. -->
<asp:Content ContentPlaceHolderID="MainContent" runat="server">
  <h1>Sign up</h1>
  <asp:TextBox ID="EmailBox" runat="server" />
  <asp:Button ID="SignupButton" runat="server" Text="Sign up" OnClick="SignupButton_Click" />
</asp:Content>
