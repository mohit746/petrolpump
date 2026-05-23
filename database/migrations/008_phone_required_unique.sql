-- Migration 008: Make phone number required and unique for mobile login support

-- Step 1: Normalise — strip spaces, dashes, brackets from all existing phone values
UPDATE public.users
SET phone = REGEXP_REPLACE(phone, '[\s\-()+]', '', 'g')
WHERE phone IS NOT NULL AND phone <> '';

-- Step 2: Clear blank strings left after normalisation
UPDATE public.users
SET phone = NULL
WHERE phone = '';

-- Step 3: Handle duplicates — keep the phone on the NEWEST user row,
--         null it out on all older duplicates for the same number.
--         (test/seed rows like 1111111111 are treated as placeholder data)
UPDATE public.users u
SET phone = NULL
WHERE phone IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (phone) id
    FROM public.users
    WHERE phone IS NOT NULL
    ORDER BY phone, created_at DESC NULLS LAST
  );

-- Step 4: Add partial unique index (allows NULLs, prevents duplicate non-null numbers)
DROP INDEX IF EXISTS idx_users_phone_unique;
CREATE UNIQUE INDEX idx_users_phone_unique
  ON public.users (phone)
  WHERE phone IS NOT NULL;

-- Step 5: Document the column intent
COMMENT ON COLUMN public.users.phone IS
  'Normalised phone number (digits only, no spaces/dashes). Used for mobile-number login lookup. Unique per user when set.';
