-- Broke at 19: database schema (PostgreSQL)
-- Every gift is KES 3 or more, paid by M-Pesa. Amounts are whole shillings.

-- Backers: one row per gift.
-- A row is created as 'pending' when checkout starts, and only counts
-- once the payment webhook flips it to 'paid'.
CREATE TABLE backers (
    id               BIGSERIAL PRIMARY KEY,
    backer_number    INTEGER UNIQUE,              -- assigned when payment is confirmed
    display_name     VARCHAR(40),                 -- optional, plain text only
    instagram_handle VARCHAR(30),                 -- optional, handle only, never a URL
    phone            VARCHAR(12),                 -- 2547XXXXXXXX: the person's ID (no login)
    person_number    INTEGER,                     -- the card number; the same phone always gets the same one
    county_id        SMALLINT NOT NULL DEFAULT 0  -- 1-47 = Kenya's counties, 0 = not given / somewhere else
                     CHECK (county_id BETWEEN 0 AND 47),
    referral_code    VARCHAR(12) NOT NULL UNIQUE, -- this backer's own share link code
    referred_by      BIGINT REFERENCES backers(id),
    amount_kes       INTEGER NOT NULL CHECK (amount_kes >= 3),
    provider         VARCHAR(20) NOT NULL DEFAULT 'intasend',
    payment_ref      VARCHAR(100) UNIQUE,         -- our reference sent to IntaSend (idempotency)
    invoice_id       VARCHAR(40),                 -- IntaSend's own id for this payment (we ask IntaSend about it)
    status           VARCHAR(10) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    hidden           BOOLEAN NOT NULL DEFAULT FALSE, -- admin moderation switch
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at          TIMESTAMPTZ
);

CREATE INDEX idx_backers_status_paid ON backers (status, paid_at DESC);
CREATE INDEX idx_backers_county ON backers (county_id) WHERE status = 'paid';
CREATE INDEX idx_backers_referred_by ON backers (referred_by);
CREATE INDEX idx_backers_phone ON backers (phone) WHERE status = 'paid';

-- Backer numbers are handed out in order of confirmed payment.
CREATE SEQUENCE backer_number_seq START 1;

-- Person numbers (the card number): one per phone, handed out at the first confirmed payment.
CREATE SEQUENCE person_number_seq START 1;

-- Call this from the payment webhook when IntaSend confirms a payment.
CREATE OR REPLACE FUNCTION confirm_backer(p_payment_ref TEXT)
RETURNS INTEGER AS $$
DECLARE
    n  INTEGER;
    ph VARCHAR(12);
    pn INTEGER;
BEGIN
    SELECT phone INTO ph FROM backers WHERE payment_ref = p_payment_ref AND status = 'pending';
    IF NOT FOUND THEN
        RETURN NULL;  -- already confirmed or unknown (safe to replay webhooks)
    END IF;

    IF ph IS NOT NULL THEN
        -- Two quick payments from one phone must not get two person numbers.
        PERFORM pg_advisory_xact_lock(hashtext(ph));
        SELECT person_number INTO pn FROM backers
         WHERE phone = ph AND status = 'paid' AND person_number IS NOT NULL
         LIMIT 1;
    END IF;

    UPDATE backers
       SET status = 'paid',
           paid_at = now(),
           backer_number = COALESCE(backer_number, nextval('backer_number_seq')),
           person_number = COALESCE(pn, nextval('person_number_seq'))
     WHERE payment_ref = p_payment_ref
       AND status = 'pending'
    RETURNING backer_number INTO n;
    RETURN n;
END;
$$ LANGUAGE plpgsql;

-- Public views: the site and the corner widget only read these.

-- /api/count
CREATE VIEW v_count AS
SELECT COUNT(*) AS backers,                 -- every paid give
       COUNT(DISTINCT person_number) AS people,  -- every different phone
       COALESCE(SUM(amount_kes), 0) AS total_kes
  FROM backers
 WHERE status = 'paid';

-- County race
CREATE VIEW v_county_leaderboard AS
SELECT county_id,
       COUNT(DISTINCT person_number) AS backers
  FROM backers
 WHERE status = 'paid'
 GROUP BY county_id;

-- The wall (hidden entries and anonymous details are handled here)
CREATE VIEW v_wall AS
SELECT backer_number,
       person_number,
       COALESCE(NULLIF(display_name, ''), 'Person #' || person_number) AS name,
       instagram_handle,
       county_id,
       amount_kes,
       paid_at
  FROM backers
 WHERE status = 'paid' AND hidden = FALSE;

-- Top referrers (shown as backer number + count only)
CREATE VIEW v_top_referrers AS
SELECT r.backer_number,
       COALESCE(NULLIF(r.display_name, ''), 'Backer #' || r.backer_number) AS name,
       COUNT(b.id) AS referred
  FROM backers r
  JOIN backers b ON b.referred_by = r.id AND b.status = 'paid'
 WHERE r.status = 'paid' AND r.hidden = FALSE
 GROUP BY r.backer_number, r.display_name
 ORDER BY referred DESC
 LIMIT 20;