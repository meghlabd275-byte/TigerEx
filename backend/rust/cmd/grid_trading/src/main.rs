//! TigerEx grid trading bot service.

fn main() {
    eprintln!(
        "TigerEx grid trading service is disabled: canonical matching engine, \
         persistent accounts and verified market data are not configured."
    );
    std::process::exit(78);
}
