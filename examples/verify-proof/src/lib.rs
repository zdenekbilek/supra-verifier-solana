//! Stateless integration example. Timing inputs are caller supplied here;
//! a real application must derive them from its own authenticated state.
use solana_program::{
    account_info::AccountInfo, clock::Clock, entrypoint, entrypoint::ProgramResult,
    program::set_return_data, pubkey::Pubkey, sysvar::Sysvar,
};
use supra_verifier_solana::{Error, Proof, MAX_AGE_MS};

/// Example policy: accept the original observation only in the exact scheduled
/// second, never in the future, no older than 30 minutes, and strictly ordered.
/// `expected_second` and `now_second` are seconds; other timestamps are milliseconds.
pub fn validate_time(
    timestamp_ms: u64,
    expected_second: u64,
    previous_ms: u64,
    now_second: u64,
) -> Result<(), Error> {
    let start = expected_second.checked_mul(1_000).ok_or(Error::Window)?;
    let end = start.checked_add(999).ok_or(Error::Window)?;
    let now_ms = now_second.checked_mul(1_000).ok_or(Error::Future)?;
    if timestamp_ms < start || timestamp_ms > end {
        return Err(Error::Window);
    }
    if timestamp_ms > now_ms {
        return Err(Error::Future);
    }
    if now_ms - timestamp_ms > MAX_AGE_MS {
        return Err(Error::Stale);
    }
    if timestamp_ms <= previous_ms {
        return Err(Error::Ordering);
    }
    Ok(())
}

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if !accounts.is_empty() || data.len() < 16 {
        return Err(Error::Encoding.into());
    }
    let expected_second = u64::from_le_bytes(data[..8].try_into().unwrap());
    let previous_ms = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let quote = Proof::decode(&data[16..])?.verify()?;
    let now_second = u64::try_from(Clock::get()?.unix_timestamp).map_err(|_| Error::Future)?;
    validate_time(
        quote.timestamp_ms(),
        expected_second,
        previous_ms,
        now_second,
    )?;
    // Consumers must check the CPI return program ID and bind timing/trust to
    // their own accounts. This example persists neither prices nor replay state.
    set_return_data(quote.as_bytes());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_second_preserves_all_original_milliseconds() {
        for milliseconds in [0, 138, 999] {
            assert_eq!(validate_time(30_000 + milliseconds, 30, 0, 31), Ok(()));
        }
        assert_eq!(validate_time(29_999, 30, 0, 31), Err(Error::Window));
        assert_eq!(validate_time(31_000, 30, 0, 31), Err(Error::Window));
    }

    #[test]
    fn rejects_future_stale_unordered_and_overflowing_inputs() {
        assert_eq!(validate_time(30_001, 30, 0, 30), Err(Error::Future));
        assert_eq!(validate_time(30_000, 30, 0, 29), Err(Error::Future));
        assert_eq!(validate_time(30_000, 30, 30_000, 31), Err(Error::Ordering));
        assert_eq!(validate_time(30_000, 30, 30_001, 31), Err(Error::Ordering));
        assert_eq!(validate_time(30_000, 30, 0, 1_830), Ok(()));
        assert_eq!(validate_time(30_000, 30, 0, 1_831), Err(Error::Stale));
        assert_eq!(validate_time(0, u64::MAX, 0, 0), Err(Error::Window));
        assert_eq!(validate_time(30_000, 30, 0, u64::MAX), Err(Error::Future));
        assert_eq!(
            validate_time(u64::MAX, u64::MAX / 1000, 0, 0),
            Err(Error::Window)
        );
    }
}
