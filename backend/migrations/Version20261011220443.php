<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261011220443 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Cuentas, sesiones por dispositivo, conexiones en la nube y tabla de los límites de intentos';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE app_user (id UUID NOT NULL, email VARCHAR(180) NOT NULL, password VARCHAR(255) NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, connections_revision INT NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_88BDF3E9E7927C74 ON app_user (email)');
        $this->addSql('CREATE TABLE connection_entry (id VARCHAR(64) NOT NULL, position INT NOT NULL, parent_id VARCHAR(64) DEFAULT NULL, kind VARCHAR(10) NOT NULL, name TEXT NOT NULL, data JSONB NOT NULL, secrets TEXT DEFAULT NULL, updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, user_id UUID NOT NULL, PRIMARY KEY (user_id, id))');
        $this->addSql('CREATE INDEX IDX_EDEB54C5A76ED395 ON connection_entry (user_id)');
        $this->addSql('CREATE TABLE user_session (id UUID NOT NULL, token_hash VARCHAR(64) NOT NULL, device_name VARCHAR(100) NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, last_used_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, expires_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, user_id UUID NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_8849CBDEB3BC57DA ON user_session (token_hash)');
        $this->addSql('CREATE INDEX idx_user_session_user ON user_session (user_id)');
        $this->addSql('CREATE TABLE cache_items (item_id VARCHAR(255) NOT NULL, item_data BYTEA NOT NULL, item_lifetime INT DEFAULT NULL, item_time INT NOT NULL, PRIMARY KEY (item_id))');
        $this->addSql('ALTER TABLE connection_entry ADD CONSTRAINT FK_EDEB54C5A76ED395 FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE');
        $this->addSql('ALTER TABLE user_session ADD CONSTRAINT FK_8849CBDEA76ED395 FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE NOT DEFERRABLE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE connection_entry DROP CONSTRAINT FK_EDEB54C5A76ED395');
        $this->addSql('ALTER TABLE user_session DROP CONSTRAINT FK_8849CBDEA76ED395');
        $this->addSql('DROP TABLE app_user');
        $this->addSql('DROP TABLE connection_entry');
        $this->addSql('DROP TABLE user_session');
        $this->addSql('DROP TABLE cache_items');
    }
}
