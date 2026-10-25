use super::*;
use ring::pbkdf2;
use std::num::NonZeroU32;

#[test]
fn shared_vectors_pbkdf2_and_hmac_bind_every_field() {
    // El mismo fichero que comprueban TypeScript, Dart y el prototipo C++.
    let file: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../src/shared/remote/auth-vectors.json"
    ))
    .unwrap();
    assert_eq!(file["context"], "absor-remote-auth-v1");
    for vector in file["vectors"].as_array().unwrap() {
        let key = STANDARD.decode(vector["key"].as_str().unwrap()).unwrap();
        if let Some(password) = vector["password"].as_str() {
            let salt = STANDARD.decode(vector["salt"].as_str().unwrap()).unwrap();
            let mut derived = [0; 32];
            pbkdf2::derive(
                pbkdf2::PBKDF2_HMAC_SHA256,
                NonZeroU32::new(vector["iterations"].as_u64().unwrap() as u32).unwrap(),
                &salt,
                password.as_bytes(),
                &mut derived,
            );
            assert_eq!(key, derived);
        }
        let nonce = vector["nonce"].as_str().unwrap();
        let offer = vector["offerFingerprint"].as_str().unwrap();
        let answer = vector["answerFingerprint"].as_str().unwrap();
        let proof = STANDARD.decode(vector["proof"].as_str().unwrap()).unwrap();
        let signing_key = hmac::Key::new(hmac::HMAC_SHA256, &key);
        assert!(hmac::verify(
            &signing_key,
            message(nonce, offer, answer).as_bytes(),
            &proof
        )
        .is_ok());
        for context in [
            message(&format!("{nonce}x"), offer, answer),
            message(nonce, &format!("{offer}x"), answer),
            message(nonce, offer, &format!("{answer}x")),
            message(nonce, answer, offer),
        ] {
            assert!(hmac::verify(&signing_key, context.as_bytes(), &proof).is_err());
        }
        let mut wrong = key;
        wrong[0] ^= 1;
        assert!(hmac::verify(
            &hmac::Key::new(hmac::HMAC_SHA256, &wrong),
            message(nonce, offer, answer).as_bytes(),
            &proof
        )
        .is_err());
    }
}
