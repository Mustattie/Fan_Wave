-- ============================================================
-- Migration 013: Referral System
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_count INT DEFAULT 0;

-- Auto-generate referral code on user creation
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.referral_code IS NULL THEN
        NEW.referral_code := LOWER(SUBSTRING(MD5(NEW.auth_id::TEXT || NOW()::TEXT) FROM 1 FOR 8));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_referral_code ON users;
CREATE TRIGGER trg_generate_referral_code
    BEFORE INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION generate_referral_code();

-- RPC: apply referral code during signup
CREATE OR REPLACE FUNCTION apply_referral(p_referral_code TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_referrer_id UUID;
    v_count INT;
BEGIN
    -- Find referrer
    SELECT auth_id INTO v_referrer_id FROM users WHERE referral_code = LOWER(p_referral_code);
    IF v_referrer_id IS NULL THEN RETURN; END IF;
    IF v_referrer_id = auth.uid() THEN RETURN; END IF;

    -- Set referred_by on current user
    UPDATE users SET referred_by = v_referrer_id WHERE auth_id = auth.uid() AND referred_by IS NULL;

    -- Increment referrer's count
    UPDATE users SET referral_count = referral_count + 1 WHERE auth_id = v_referrer_id;

    -- Award recruiter badge at 3 referrals
    SELECT referral_count INTO v_count FROM users WHERE auth_id = v_referrer_id;
    IF v_count >= 3 THEN
        PERFORM award_badge(v_referrer_id, 'recruiter');
    END IF;
END;
$$;

-- Add recruiter badge if not exists
INSERT INTO badges (key, name, description, icon, category)
VALUES ('recruiter', 'Recruiter', 'Invited 3+ friends to Fan Wave', '🎯', 'social')
ON CONFLICT (key) DO NOTHING;

-- RPC: get own referral code
CREATE OR REPLACE FUNCTION get_my_referral_code()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
    SELECT referral_code FROM users WHERE auth_id = auth.uid();
$$;
