<?php

namespace App\Repository;

use App\Entity\User;
use App\Entity\UserSession;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/** @extends ServiceEntityRepository<UserSession> */
class UserSessionRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, UserSession::class);
    }

    public function findActiveByTokenHash(string $tokenHash, \DateTimeImmutable $now): ?UserSession
    {
        return $this->createQueryBuilder('s')
            ->addSelect('u')
            ->join('s.user', 'u')
            ->where('s.tokenHash = :hash')
            ->andWhere('s.expiresAt > :now')
            ->setParameter('hash', $tokenHash)
            ->setParameter('now', $now)
            ->getQuery()
            ->getOneOrNullResult();
    }

    /** Borra las sesiones de la cuenta, salvo $keep si se indica. */
    public function deleteForUser(User $user, ?UserSession $keep = null): void
    {
        $qb = $this->createQueryBuilder('s')
            ->delete()
            ->where('s.user = :user')
            ->setParameter('user', $user);
        if (null !== $keep) {
            $qb->andWhere('s.id != :keep')->setParameter('keep', $keep->getId(), 'uuid');
        }
        $qb->getQuery()->execute();
    }

    public function deleteExpiredForUser(User $user, \DateTimeImmutable $now): void
    {
        $this->createQueryBuilder('s')
            ->delete()
            ->where('s.user = :user')
            ->andWhere('s.expiresAt <= :now')
            ->setParameter('user', $user)
            ->setParameter('now', $now)
            ->getQuery()
            ->execute();
    }
}
