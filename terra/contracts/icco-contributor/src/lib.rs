#[cfg(test)]
extern crate lazy_static;

pub mod contract;
mod error;
mod execute;
mod msg;
mod query;
mod shared;
mod state;

#[cfg(test)]
mod testing;
