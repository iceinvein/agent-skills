using System;
using System.Configuration;
using System.Data.SqlClient;
using Quartz;

namespace TinyWebForms.Jobs
{
  // Nightly purge of AuditLog rows older than the configured cutoff.
  public class NightlyDigestJob : IJob
  {
    public void Execute(IJobExecutionContext context)
    {
      var cutoffDays = int.Parse(ConfigurationManager.AppSettings["NightlyDigestCutoffDays"]);
      var connStr = ConfigurationManager.ConnectionStrings["DefaultConnection"].ConnectionString;
      using (var conn = new SqlConnection(connStr))
      {
        var cmd = new SqlCommand("DELETE FROM AuditLog WHERE CreatedAt < @cutoff", conn);
        cmd.Parameters.AddWithValue("@cutoff", DateTime.UtcNow.AddDays(-cutoffDays));
        conn.Open();
        cmd.ExecuteNonQuery();
      }
    }
  }

  public static class NightlyDigestJobScheduler
  {
    public static void Register(IScheduler scheduler)
    {
      var job = JobBuilder.Create<NightlyDigestJob>().WithIdentity("nightly-digest").Build();
      scheduler.ScheduleJob(job, TriggerBuilder.Create().WithCronSchedule("0 0 2 * * ?").Build());
    }
  }
}
