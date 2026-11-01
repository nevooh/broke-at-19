-- Broke at 19: giveaway milestones (all amounts in Kenya shillings)
-- Run after schema.sql. Backer counts are the trigger, not money raised.

CREATE TABLE milestones (
    id              SERIAL PRIMARY KEY,
    backers_needed  INTEGER NOT NULL UNIQUE,
    prize_total_kes INTEGER NOT NULL,   -- total given away at this milestone
    winners         INTEGER NOT NULL,   -- how many people share it
    label           VARCHAR(80) NOT NULL,
    reached_at      TIMESTAMPTZ,        -- set when the count crosses the line
    video_url       TEXT                -- link to the (faces blurred) giveaway video
);

-- If every milestone is reached, KES 273,300 has been given away (about 9% of KES 3 million raised).
INSERT INTO milestones (backers_needed, prize_total_kes, winners, label) VALUES
    (1000,    300,    1,  '1,000 backers: KES 300 giveaway'),
    (10000,   3000,   1,  '10,000 backers: KES 3,000 giveaway'),
    (100000,  30000,  10, '100,000 backers: KES 30,000 to 10 people (KES 3,000 each)'),
    (500000,  90000,  30, '500,000 backers: KES 90,000 to 30 people (KES 3,000 each)'),
    (1000000, 150000, 50, '1 million backers: KES 150,000 to 50 people (KES 3,000 each)');

-- Giveaway winners, filled in after each draw (public record).
CREATE TABLE giveaway_winners (
    id           SERIAL PRIMARY KEY,
    milestone_id INTEGER NOT NULL REFERENCES milestones(id),
    backer_id    BIGINT  NOT NULL REFERENCES backers(id),
    amount_kes   INTEGER NOT NULL,
    paid_at      TIMESTAMPTZ
);

-- Progress view for the site: current count vs each milestone.
CREATE VIEW v_milestones AS
SELECT m.id,
       m.backers_needed,
       m.prize_total_kes,
       m.winners,
       m.label,
       m.reached_at,
       m.video_url,
       c.backers AS current_backers,
       LEAST(100.0, ROUND(100.0 * c.backers / m.backers_needed, 1)) AS progress_pct
  FROM milestones m
 CROSS JOIN v_count c
 ORDER BY m.backers_needed;

-- Stamp reached_at the first time the count crosses a milestone.
-- Call this after confirm_backer() in the webhook.
CREATE OR REPLACE FUNCTION stamp_milestones() RETURNS VOID AS $$
    UPDATE milestones
       SET reached_at = now()
     WHERE reached_at IS NULL
       AND backers_needed <= (SELECT backers FROM v_count);
$$ LANGUAGE sql;