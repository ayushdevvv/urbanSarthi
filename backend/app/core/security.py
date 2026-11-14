"""Password hashing retained only for legacy seed data in the demo database."""
from argon2 import PasswordHasher

_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)
