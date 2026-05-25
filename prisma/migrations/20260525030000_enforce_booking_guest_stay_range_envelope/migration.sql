-- Enforce that each BookingGuest stay range remains inside its parent booking
-- envelope. The existing BookingGuest_stayRange_valid CHECK constraint already
-- enforces stayStart < stayEnd; these triggers close the cross-table invariant.
CREATE OR REPLACE FUNCTION "enforce_booking_guest_stay_range_within_booking"()
RETURNS trigger AS $$
DECLARE
  booking_check_in DATE;
  booking_check_out DATE;
BEGIN
  SELECT b."checkIn", b."checkOut"
  INTO booking_check_in, booking_check_out
  FROM "Booking" AS b
  WHERE b."id" = NEW."bookingId";

  -- Let the foreign-key constraint report a missing parent booking.
  IF booking_check_in IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."stayStart" < booking_check_in OR NEW."stayEnd" > booking_check_out THEN
    RAISE EXCEPTION 'BookingGuest stay range must be within parent Booking date range'
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'BookingGuest_stay_range_within_booking',
        DETAIL = format(
          'bookingId=%s stayStart=%s stayEnd=%s checkIn=%s checkOut=%s',
          NEW."bookingId",
          NEW."stayStart",
          NEW."stayEnd",
          booking_check_in,
          booking_check_out
        );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BookingGuest_stay_range_within_booking"
BEFORE INSERT OR UPDATE OF "bookingId", "stayStart", "stayEnd"
ON "BookingGuest"
FOR EACH ROW
EXECUTE FUNCTION "enforce_booking_guest_stay_range_within_booking"();

CREATE OR REPLACE FUNCTION "enforce_booking_dates_consistent_with_guests"()
RETURNS trigger AS $$
DECLARE
  violating_guest_id TEXT;
BEGIN
  SELECT bg."id"
  INTO violating_guest_id
  FROM "BookingGuest" AS bg
  WHERE bg."bookingId" = NEW."id"
    AND (bg."stayStart" < NEW."checkIn" OR bg."stayEnd" > NEW."checkOut")
  ORDER BY bg."id"
  LIMIT 1;

  IF violating_guest_id IS NOT NULL THEN
    RAISE EXCEPTION 'Booking date range must contain all BookingGuest stay ranges'
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'Booking_dates_consistent_with_guests',
        DETAIL = format(
          'bookingId=%s bookingGuestId=%s checkIn=%s checkOut=%s',
          NEW."id",
          violating_guest_id,
          NEW."checkIn",
          NEW."checkOut"
        );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Booking_dates_consistent_with_guests"
BEFORE UPDATE OF "checkIn", "checkOut"
ON "Booking"
FOR EACH ROW
EXECUTE FUNCTION "enforce_booking_dates_consistent_with_guests"();
