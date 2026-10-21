pipeline {
    agent any
    environment {
        KUBECONFIG = credentials('kubeconfCloudNetCup')
    }
    stages {
        stage('Build and push image') {
            steps {
                script {
                    withCredentials([usernamePassword(credentialsId: 'dockerhub', usernameVariable: 'DOCKERHUB_USER', passwordVariable: 'DOCKERHUB_PASSWORD')]) {
                        sh "docker login -u $DOCKERHUB_USER -p $DOCKERHUB_PASSWORD"
                        sh "docker build --pull -t absortian/absortian:php-absorconnect-1.0.0 -f docker/prod/php/Dockerfile ."
                        sh "docker push absortian/absortian:php-absorconnect-1.0.0"
                    }
                }
            }
        }
        stage('Config kube') {
            steps {
                script {
                    sh "cd kube && kubectl apply -f 00-namespace.yaml"
                    try {
                        withCredentials([usernamePassword(credentialsId: 'dockerhub', usernameVariable: 'DOCKERHUB_USER', passwordVariable: 'DOCKERHUB_PASSWORD')]) {
                            sh "kubectl create secret docker-registry absortian -n absorconnect --docker-username=$DOCKERHUB_USER --docker-password=$DOCKERHUB_PASSWORD"
                        }
                    } catch (e) {
                        withCredentials([usernamePassword(credentialsId: 'dockerhub', usernameVariable: 'DOCKERHUB_USER', passwordVariable: 'DOCKERHUB_PASSWORD')]) {
                            sh "kubectl delete secret absortian -n absorconnect"
                            sh "kubectl create secret docker-registry absortian -n absorconnect --docker-username=$DOCKERHUB_USER --docker-password=$DOCKERHUB_PASSWORD"
                        }
                    }
                    // La config de runtime vive en el Secret absorconnect-env, creado a mano con
                    // kube/make-env-secret.sh desde backend/.env_prod (no está en el repo). Sin él
                    // los pods arrancarían sin DATABASE_URL ni CONNECTIONS_KEY de producción.
                    sh "kubectl get secret absorconnect-env -n absorconnect"
                    sh "cd kube && kubectl apply -f 02-php-service.yaml"
                    sh "cd kube && kubectl apply -f 03-php-pdb.yaml"

                    try {
                        sh "cd kube && kubectl delete job absorconnect-php -n absorconnect"
                    } catch (e) {}
                    sh "cd kube && kubectl apply -f 01-00-php-job.yaml"
                    // La imagen lleva RUN_MIGRATIONS=0: el Job es la única vía de migración,
                    // así que esperamos a que complete antes de desplegar el código nuevo.
                    sh "kubectl wait --for=condition=complete job/absorconnect-php -n absorconnect --timeout=5m"
                }
            }
        }
        stage('Apply deployment') {
            steps {
                script {
                    sh "cd kube && kubectl apply -f 01-php-deployment.yaml"

                    // El tag es estable a propósito: aplicar un manifiesto sin cambios no
                    // recrea pods aunque imagePullPolicy sea Always; el restart es el deploy.
                    sh "kubectl rollout restart deployment/absorconnect-php -n absorconnect"
                    sh "kubectl rollout status deployment/absorconnect-php -n absorconnect --timeout=10m"
                }
            }
        }
        stage('Cleanup images') {
            steps {
                script {
                    sh "docker rmi absortian/absortian:php-absorconnect-1.0.0 || true"
                }
            }
        }
    }
}
