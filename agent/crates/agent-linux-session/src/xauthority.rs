//! Lector binario estricto de Xauthority. Solo lo usa el proveedor local tras validar la concesión.
use crate::grant::GrantError;
pub fn cookie(raw: &[u8], display: u8) -> Result<[u8; 16], GrantError> {
    if raw.is_empty() || raw.len() > 65536 {
        return Err(GrantError);
    }
    fn field<'a>(raw: &'a [u8], offset: &mut usize) -> Result<&'a [u8], GrantError> {
        let end = offset.checked_add(2).ok_or(GrantError)?;
        let value = raw.get(*offset..end).ok_or(GrantError)?;
        *offset = end;
        let end = offset
            .checked_add(u16::from_be_bytes(value.try_into().map_err(|_| GrantError)?) as usize)
            .ok_or(GrantError)?;
        let value = raw.get(*offset..end).ok_or(GrantError)?;
        *offset = end;
        Ok(value)
    }
    let mut offset = 0;
    let mut found = None;
    let display = display.to_string();
    while offset < raw.len() {
        let family = u16::from_be_bytes(
            raw.get(offset..offset + 2)
                .ok_or(GrantError)?
                .try_into()
                .map_err(|_| GrantError)?,
        );
        offset += 2;
        let _address = field(raw, &mut offset)?;
        let number = field(raw, &mut offset)?;
        let name = field(raw, &mut offset)?;
        let data = field(raw, &mut offset)?;
        if [256, 65535].contains(&family)
            && number == display.as_bytes()
            && name == b"MIT-MAGIC-COOKIE-1"
            && data.len() == 16
        {
            if found.is_some() {
                return Err(GrantError);
            }
            found = Some(data.try_into().map_err(|_| GrantError)?);
        }
    }
    found.ok_or(GrantError)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn record(family: u16, display: &[u8], name: &[u8], value: &[u8]) -> Vec<u8> {
        let mut raw = family.to_be_bytes().to_vec();
        for part in [b"public-fixture".as_slice(), display, name, value] {
            raw.extend_from_slice(&(part.len() as u16).to_be_bytes());
            raw.extend_from_slice(part);
        }
        raw
    }
    fn valid() -> Vec<u8> {
        record(256, b"0", b"MIT-MAGIC-COOKIE-1", &[42; 16])
    }
    #[test]
    fn exact_record_and_wildcard() {
        assert_eq!(cookie(&valid(), 0), Ok([42; 16]));
        assert_eq!(
            cookie(&record(65535, b"0", b"MIT-MAGIC-COOKIE-1", &[42; 16]), 0),
            Ok([42; 16])
        );
    }
    #[test]
    fn truncation_and_trailing_data_are_not_ignored() {
        let raw = valid();
        for size in 0..raw.len() {
            assert!(cookie(&raw[..size], 0).is_err());
        }
        for suffix in [vec![0], vec![0, 0], vec![1, 0, 255, 255]] {
            let mut value = raw.clone();
            value.extend(suffix);
            assert!(cookie(&value, 0).is_err());
        }
    }
    #[test]
    fn ambiguity_and_foreign_records() {
        let mut value = valid();
        value.extend(valid());
        assert!(cookie(&value, 0).is_err());
        for raw in [
            record(0, b"0", b"MIT-MAGIC-COOKIE-1", &[42; 16]),
            record(256, b"1", b"MIT-MAGIC-COOKIE-1", &[42; 16]),
            record(256, b"00", b"MIT-MAGIC-COOKIE-1", &[42; 16]),
            record(256, b"0", b"other", &[42; 16]),
            record(256, b"0", b"MIT-MAGIC-COOKIE-1", &[42; 15]),
        ] {
            assert!(cookie(&raw, 0).is_err());
        }
    }
    #[test]
    fn bounded_and_exact_matching() {
        assert!(cookie(&vec![0; 65537], 0).is_err());
        let mut value = record(256, b"1", b"MIT-MAGIC-COOKIE-1", &[1; 16]);
        value.extend(valid());
        assert_eq!(cookie(&value, 0), Ok([42; 16]));
    }
}
