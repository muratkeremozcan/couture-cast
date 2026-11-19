-- Production follow-up 2026-11-19: a comment the screener held is due 30 minutes after intake, so a
-- held safe comment waits minutes for a moderator. A member report keeps the 24-hour deadline, and
-- both keep the 5-minute routing bound.
-- A screening row may also carry the earlier 24-hour deadline. Rows already written have it, and so
-- do rows a previous API or worker build writes during a delayed deploy or after a rollback; a
-- check that refused them would fail this migration on such a row or fail every held comment from
-- that build. Every current writer uses 30 minutes.
ALTER TABLE "CommunityCommentReport" DROP CONSTRAINT comment_report_routing_deadline;
ALTER TABLE "CommunityCommentReport" ADD CONSTRAINT comment_report_routing_deadline CHECK
  (routed_at >= accepted_at AND routed_at <= accepted_at + interval '5 minutes'
   AND (
     (origin <> 'screening' AND sla_due_at = accepted_at + interval '24 hours')
     OR (origin = 'screening' AND sla_due_at IN (accepted_at + interval '30 minutes',
                                                accepted_at + interval '24 hours'))
   ));
